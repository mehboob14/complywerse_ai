"""Flow 1 — "we host the scanner" orchestration.

Drive a scan on our hosted Nessus/Tenable to completion, then pull the findings
through the normal full-sync pipeline. Runs inside a background daemon thread
(see integrations/router.py), so it may block on polling.

The endpoint creates the `HostedScanRun` row (status ``creating``) and this
worker updates it through the lifecycle, committing after each transition so the
UI can poll live status/progress and offer a stop.
"""
import logging
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from grc.models import IntegrationConnection, HostedScanRun
from .sync_service import SyncService

logger = logging.getLogger(__name__)

# Scanner status strings we treat as terminal-without-success. "completed" is
# handled separately (success). Anything else (running/pending/…) keeps polling.
_TERMINAL_FAILURES = ("aborted", "canceled", "cancelled", "stopped")


def _scan_id_from(created: Any) -> Any:
    # ponytail: guess the scan-id shape — Nessus returns {"scan": {"id": N}},
    # some adapters flatten to {"id": N}. Try both, else assume it's the id.
    if not isinstance(created, dict):
        return created
    inner = created.get("scan") if isinstance(created.get("scan"), dict) else created
    return inner.get("id") or created.get("id") or created.get("scan_id")


def _ratio(cur: Any, tot: Any) -> Optional[float]:
    try:
        cur = float(cur)
        tot = float(tot)
    except (TypeError, ValueError):
        return None
    if tot <= 0:
        return None
    return max(0.0, min(1.0, cur / tot))


def _host_fraction(h: Any) -> Optional[float]:
    """Completion fraction (0..1) of one Nessus host entry, or None if unreadable.
    Handles ``progress`` as "cur/total", as a bare percent, and the explicit
    ``scanprogresscurrent``/``scanprogresstotal`` counters."""
    if not isinstance(h, dict):
        return None
    p = h.get("progress")
    if isinstance(p, str) and "/" in p:
        cur, _, tot = p.partition("/")
        f = _ratio(cur, tot)
        if f is not None:
            return f
    elif p is not None:
        try:
            return max(0.0, min(1.0, float(p) / 100.0))
        except (TypeError, ValueError):
            pass
    return _ratio(h.get("scanprogresscurrent"), h.get("scanprogresstotal"))


def _progress_from_detail(detail: Any) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    """Best-effort (progress%, hosts_total, hosts_done) from a Nessus scan detail.
    Every field is optional — returns (None, None, None) when nothing is present."""
    if not isinstance(detail, dict):
        return None, None, None
    info = detail.get("info") or {}
    hosts = detail.get("hosts") or []
    hosts_total = len(hosts) or info.get("hostcount")
    fracs, done = [], 0
    for h in hosts:
        f = _host_fraction(h)
        if f is not None:
            fracs.append(f)
            if f >= 0.999:
                done += 1
    progress = int(round(100 * sum(fracs) / len(fracs))) if fracs else None
    return progress, hosts_total, (done if hosts else None)


def _norm_targets(t: Optional[str]) -> str:
    """Order/dup-insensitive normalized target set, so a re-scan of the same
    hosts matches its prior run regardless of tick order, spacing, or repeats."""
    return ",".join(sorted({s.strip() for s in (t or "").split(",") if s.strip()}))


def _find_reusable_scan_id(db: Session, tenant_id: int, run: "HostedScanRun") -> Optional[str]:
    """The Nessus scan id of the most-recent prior hosted run on the SAME
    connection + SAME target set. Reusing it (re-configure + re-launch in place)
    is what makes verified-fixed auto-close work: the closure engine proves a
    finding is gone by re-running the SAME scan that last reported it. A fresh
    scan id every run would leave the old scan forever reporting the fixed
    finding, so nothing would ever close. Returns None on the first scan of
    these targets (→ create a new scan)."""
    want = _norm_targets(run.targets)
    if not want:
        return None
    prior = db.query(HostedScanRun).filter(
        HostedScanRun.tenant_id == tenant_id,
        HostedScanRun.connection_id == run.connection_id,
        HostedScanRun.id != run.id,
        HostedScanRun.nessus_scan_id.isnot(None),
    ).order_by(HostedScanRun.id.desc()).limit(25).all()
    for p in prior:
        if _norm_targets(p.targets) == want:
            return p.nessus_scan_id
    return None


def _resolve_credentials(
    db: Session, tenant_id: int, credential_profile_ids: Optional[Sequence[int]]
) -> Optional[List[Dict[str, Any]]]:
    """Resolve tenant credential profiles into the scan-level list create_scan()
    wants. Reuses the discovery credential store (`grc_credential_profiles`) and
    the SAME decrypt path deep-collect uses (grc.crypto.decrypt_secret) — no new
    store, no new crypto. Maps winrm→windows / ssh→ssh. Returns None when nothing
    usable so the scan stays unauthenticated. Secrets are never logged."""
    from grc.crypto import decrypt_secret
    from grc.models import CredentialProfile

    out: List[Dict[str, Any]] = []
    # Host logins (WinRM/SSH) — only the ones the operator attached to this scan.
    if credential_profile_ids:
        profiles = db.query(CredentialProfile).filter(
            CredentialProfile.tenant_id == tenant_id,
            CredentialProfile.id.in_(list(credential_profile_ids)),
            CredentialProfile.is_active.is_(True),
            CredentialProfile.kind.in_(("winrm", "ssh")),
        ).order_by(CredentialProfile.priority, CredentialProfile.id).all()
        for p in profiles:
            secret = decrypt_secret(p.secret_encrypted)
            if p.kind == "winrm":
                out.append({"type": "windows", "username": p.username,
                            "password": secret, "domain": p.domain})
            else:  # ssh
                out.append({"type": "ssh", "username": p.username,
                            "password": secret if p.secret_kind == "password" else None,
                            "private_key": secret if p.secret_kind == "ssh_key" else None})

    # SNMP — ALWAYS include the tenant's active community strings, regardless of
    # what host logins were picked. Nessus reads network gear / printers over
    # SNMP (community only, no username), so "use every credential kind we have"
    # means every scan should also carry the SNMP communities. Deduped.
    snmp = db.query(CredentialProfile).filter(
        CredentialProfile.tenant_id == tenant_id,
        CredentialProfile.is_active.is_(True),
        CredentialProfile.kind == "snmp",
    ).order_by(CredentialProfile.priority, CredentialProfile.id).all()
    seen: set = set()
    for p in snmp:
        comm = decrypt_secret(p.secret_encrypted)
        if comm and comm not in seen:
            seen.add(comm)
            out.append({"type": "snmp", "community": comm})
    return out or None


def run_hosted_scan(
    db: Session,
    run_id: int,
    tenant_id: int,
    *,
    credential_profile_ids: Optional[Sequence[int]] = None,
    poll_timeout_s: int = 1800,
    poll_interval_s: int = 15,
) -> Dict[str, Any]:
    """Drive an existing HostedScanRun row: create → launch → poll → sync.

    Reads connection_id/targets/scan_name/policy_id off the row; commits after
    every state transition. Wrapped defensively — a transient poll error keeps
    polling; a hard failure lands the row in status 'failed' with the error."""
    run = db.query(HostedScanRun).filter(
        HostedScanRun.id == run_id,
        HostedScanRun.tenant_id == tenant_id,
    ).first()
    if not run:
        raise ValueError("Hosted scan run not found")

    def _fail(msg: Any) -> Dict[str, Any]:
        run.status = "failed"
        run.error = str(msg)[:1000]
        run.finished_at = datetime.utcnow()
        db.commit()
        logger.warning("Hosted scan failed (run=%s): %s", run_id, run.error)
        return {"status": "failed", "run_id": run_id, "error": run.error}

    connection = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == run.connection_id,
        IntegrationConnection.tenant_id == tenant_id,
        IntegrationConnection.is_active == True,  # noqa: E712
    ).first()
    if not connection:
        return _fail("Connection not found or inactive")
    if (connection.integration_type or "").lower() not in ("nessus", "tenable"):
        return _fail("Hosted scan requires a nessus/tenable connection")

    try:
        adapter = SyncService.build_adapter(connection)
    except Exception as e:  # noqa: BLE001
        logger.exception("Hosted scan adapter build failed (run=%s)", run_id)
        return _fail(f"Adapter build failed: {e}")

    # creating → create the scan
    run.status = "creating"
    db.commit()
    try:
        # Decrypt here (fails loud if SESSION_SECRET rotated), so a bad
        # credential lands the run in 'failed' rather than silently scanning
        # unauthenticated when the operator asked for a credentialed scan.
        credentials = _resolve_credentials(db, tenant_id, credential_profile_ids)
        name = run.scan_name or "Ava hosted scan"
        # Re-scan of the same targets → reuse the prior Nessus scan in place so
        # the verified-fixed auto-close loop can fire (see _find_reusable_scan_id).
        # First scan of these targets (or a stale/deleted scan) → create a new one.
        reuse_id = _find_reusable_scan_id(db, tenant_id, run)
        scan_id: Any = None
        if reuse_id is not None:
            try:
                adapter.update_scan(reuse_id, name, run.targets,
                                    policy_id=run.policy_id, credentials=credentials)
                scan_id = reuse_id
                logger.info("Hosted scan reusing Nessus scan %s (run=%s) for verified-fixed closure",
                            reuse_id, run_id)
            except Exception:  # noqa: BLE001
                logger.warning("Hosted scan reuse of Nessus scan %s failed (run=%s) — creating a new scan",
                               reuse_id, run_id, exc_info=True)
                scan_id = None
        if scan_id is None:
            scan = adapter.create_scan(name, run.targets,
                                       policy_id=run.policy_id, credentials=credentials)
            scan_id = _scan_id_from(scan)
    except Exception as e:  # noqa: BLE001
        logger.exception("Hosted scan create failed (run=%s)", run_id)
        return _fail(f"create_scan failed: {e}")
    if scan_id is None:
        return _fail("create_scan returned no scan id")
    if _run_deleted(db, run_id):
        # Deleted while the scan was being created — don't launch a scan nobody tracks.
        logger.info("Hosted scan session deleted before launch (run=%s scan=%s)", run_id, scan_id)
        return {"status": "deleted", "run_id": run_id, "scan_id": scan_id}

    run.nessus_scan_id = str(scan_id)
    run.status = "running"
    db.commit()
    logger.info("Hosted scan created (run=%s conn=%s scan=%s targets=%r)",
                run_id, run.connection_id, scan_id, run.targets)

    try:
        adapter.launch_scan(scan_id)
    except Exception as e:  # noqa: BLE001
        logger.exception("Hosted scan launch failed (run=%s scan=%s)", run_id, scan_id)
        return _fail(f"launch_scan failed: {e}")

    return _poll_and_sync(
        db, run, run_id, tenant_id, adapter, scan_id,
        poll_interval_s=poll_interval_s, poll_timeout_s=poll_timeout_s,
    )


def _run_deleted(db: Session, run_id: int) -> bool:
    """True once the session row is gone (Delete in the UI, via another DB
    session). The poller checks this so a deleted session stops being tracked
    instead of committing onto a row that no longer exists."""
    return db.query(HostedScanRun).filter(HostedScanRun.id == run_id).first() is None


def _fail_run(db: Session, run: "HostedScanRun", run_id: int, msg: Any) -> Dict[str, Any]:
    run.status = "failed"
    run.error = str(msg)[:1000]
    run.finished_at = datetime.utcnow()
    db.commit()
    logger.warning("Hosted scan failed (run=%s): %s", run_id, run.error)
    return {"status": "failed", "run_id": run_id, "error": run.error}


def _poll_and_sync(db: Session, run: "HostedScanRun", run_id: int, tenant_id: int,
                   adapter: Any, scan_id: Any, *, poll_interval_s: int = 15,
                   poll_timeout_s: int = 1800) -> Dict[str, Any]:
    """Poll an already-launched Nessus scan to completion, then full-sync findings.

    Shared by run_hosted_scan (right after launch) AND resume_inflight_hosted_scans
    (re-attach after a backend restart). The poll loop is an in-process thread that
    does NOT survive a restart, so a scan launched before a restart would otherwise
    never sync — resume-on-startup calls this to pick it back up."""
    # ponytail: fixed poll interval, no backoff. Nessus scans run minutes; a
    # steady poll is fine — add jitter/backoff only if the API rate-limits.
    status = "running"
    deadline = time.monotonic() + poll_timeout_s
    while time.monotonic() < deadline:
        time.sleep(poll_interval_s)

        if _run_deleted(db, run_id):
            # The delete endpoint already stopped the Nessus scan; nothing to sync into.
            logger.info("Hosted scan session deleted — poller exiting (run=%s scan=%s)", run_id, scan_id)
            return {"status": "deleted", "run_id": run_id, "scan_id": scan_id}

        # Best-effort progress refresh; a transient error just skips this tick.
        try:
            progress, hosts_total, hosts_done = _progress_from_detail(adapter.get_scan_detail(str(scan_id)))
            changed = False
            for field, val in (("progress", progress), ("hosts_total", hosts_total), ("hosts_done", hosts_done)):
                if val is not None and getattr(run, field) != val:
                    setattr(run, field, val)
                    changed = True
            if changed:
                db.commit()
        except Exception:  # noqa: BLE001
            # A delete racing this commit raises StaleDataError and poisons the
            # session — roll back so next tick's deleted-check can run cleanly.
            db.rollback()
            logger.debug("Hosted scan progress refresh failed (run=%s scan=%s)", run_id, scan_id, exc_info=True)

        try:
            status = adapter.get_scan_status(scan_id)
        except Exception:  # noqa: BLE001
            logger.warning("get_scan_status failed (run=%s scan=%s) — retrying", run_id, scan_id)
            continue  # transient; keep polling until the deadline
        if status == "completed" or status in _TERMINAL_FAILURES:
            break
    else:
        return _fail_run(db, run, run_id, f"Scan did not finish within {poll_timeout_s}s (last status: {status})")

    if status == "completed":
        run.progress = 100
        db.commit()
        try:
            # Scope the sync to the hosts THIS scan actually ran against, so a
            # hosted scan of one asset never drags in every other scan sitting on
            # the scanner (the "349 findings from hosts I never picked" bug).
            _tgts = [t.strip() for t in (run.targets or "").split(",") if t.strip()]
            sync = SyncService.run_full_sync(
                db, run.connection_id, tenant_id,
                triggered_by_user_id=run.triggered_by_user_id, sync_type="hosted_scan",
                only_targets=_tgts or None,
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("Hosted scan post-sync failed (run=%s scan=%s)", run_id, scan_id)
            return _fail_run(db, run, run_id, f"Sync failed after scan: {e}")
        run.vulns_new = sync.get("vulns_new")
        run.vulns_total = sync.get("vulns_total")
        # Two-way closure: surface what this re-scan closed/reopened (already
        # done by run_full_sync's auto-close + reopen loop) so the UI can show it.
        run.vulns_closed = sync.get("vulns_closed")
        run.vulns_reopened = sync.get("vulns_reopened")
        if run.vulns_total is None:
            run.vulns_total = (sync.get("vulns_new") or 0) + (sync.get("vulns_updated") or 0)
        run.status = "completed"
        run.finished_at = datetime.utcnow()
        db.commit()
        return {"status": "completed", "run_id": run_id, "scan_id": scan_id, "sync": sync}

    # Terminal without success. If the stop endpoint already marked this run
    # (its commit is on another session), don't clobber that decision.
    db.refresh(run)
    if run.status not in ("stopped", "completed"):
        run.status = "stopped" if status == "stopped" else "aborted"
        run.finished_at = datetime.utcnow()
        db.commit()
    logger.warning("Hosted scan ended without completion (run=%s scan=%s status=%s)", run_id, scan_id, status)
    return {"status": run.status, "run_id": run_id, "scan_id": scan_id}


def resume_inflight_hosted_scans(slug: str) -> int:
    """Re-attach the poll+sync loop to any hosted scan left 'running'/'creating'
    with a Nessus scan id — called on backend startup. The poll thread doesn't
    survive a restart, so without this a scan that finishes while the backend is
    down (or restarted) never syncs and the row is stuck 'running'. Best-effort;
    returns how many runs were resumed."""
    from grc.db import open_tenant_session
    try:
        db = open_tenant_session(slug)
    except Exception:  # noqa: BLE001
        logger.debug("resume_inflight_hosted_scans: no tenant session for %r", slug, exc_info=True)
        return 0
    resumed = 0
    try:
        runs = db.query(HostedScanRun).filter(
            HostedScanRun.status.in_(("running", "creating")),
            HostedScanRun.nessus_scan_id.isnot(None),
        ).all()
        for run in runs:
            conn = db.query(IntegrationConnection).filter(
                IntegrationConnection.id == run.connection_id,
                IntegrationConnection.is_active == True,  # noqa: E712
            ).first()
            if not conn:
                continue
            try:
                adapter = SyncService.build_adapter(conn)
            except Exception:  # noqa: BLE001
                logger.warning("resume: adapter build failed (run=%s)", run.id, exc_info=True)
                continue
            rid, tid, sid = run.id, run.tenant_id, run.nessus_scan_id

            def _bg(rid=rid, tid=tid, sid=sid, adapter=adapter):
                s = open_tenant_session(slug)
                try:
                    r = s.query(HostedScanRun).filter(HostedScanRun.id == rid).first()
                    if r is not None:
                        _poll_and_sync(s, r, rid, tid, adapter, sid)
                except Exception:  # noqa: BLE001
                    logger.exception("resume poll+sync failed (run=%s)", rid)
                finally:
                    s.close()

            threading.Thread(target=_bg, daemon=True, name=f"hosted-resume-{rid}").start()
            resumed += 1
        if resumed:
            logger.info("resume_inflight_hosted_scans(%s): resumed %d in-flight scan(s)", slug, resumed)
    finally:
        db.close()
    return resumed


def _demo():
    """Self-check: fake DB row + adapter + stubbed run_full_sync, no DB/Nessus.
    Asserts the state machine walks creating→running→completed, reads progress
    from the scan detail, and syncs exactly once."""
    import types

    run = types.SimpleNamespace(
        id=7, tenant_id=1, connection_id=1, targets="10.0.0.1",
        scan_name="Ava hosted scan", policy_id=None, nessus_scan_id=None,
        status="creating", progress=0, hosts_total=None, hosts_done=None,
        vulns_new=None, vulns_total=None, error=None, triggered_by_user_id=None,
        finished_at=None,
    )
    conn = types.SimpleNamespace(id=1, tenant_id=1, integration_type="nessus", is_active=True)

    class _Q:
        def __init__(self, row):
            self._row = row

        def filter(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def limit(self, n):
            return self

        def all(self):
            return []  # no prior run → first scan of these targets → create path

        def first(self):
            return self._row

    class _DB:
        def __init__(self):
            self.commits = 0

        def query(self, model):
            return _Q(run if model is HostedScanRun else conn)

        def commit(self):
            self.commits += 1

        def refresh(self, obj):
            pass

    calls = {"create": 0, "launch": 0, "detail": 0, "status": 0, "sync": 0}
    captured: Dict[str, Any] = {}
    statuses = iter(["running", "running", "completed"])

    class _Adapter:
        def create_scan(self, name, text_targets, policy_id=None, folder_id=None, credentials=None):
            calls["create"] += 1
            captured["credentials"] = credentials
            assert text_targets == "10.0.0.1" and policy_id is None
            return {"scan": {"id": 42}}

        def update_scan(self, scan_id, name, text_targets, policy_id=None, folder_id=None, credentials=None):
            calls["update"] = calls.get("update", 0) + 1
            return {"scan": {"id": scan_id}}

        def launch_scan(self, scan_id):
            calls["launch"] += 1
            assert str(scan_id) == "42"
            return "launch-uuid"

        def get_scan_detail(self, scan_id):
            calls["detail"] += 1
            return {"info": {"hostcount": 1}, "hosts": [{"progress": "50/100"}]}

        def get_scan_status(self, scan_id):
            calls["status"] += 1
            return next(statuses)

    orig_build, orig_run = SyncService.build_adapter, SyncService.run_full_sync
    SyncService.build_adapter = staticmethod(lambda c: _Adapter())

    def _fake_run(db, cid, tid, triggered_by_user_id=None, sync_type="manual", only_targets=None):
        calls["sync"] += 1
        assert sync_type == "hosted_scan" and cid == 1
        assert only_targets == ["10.0.0.1"], only_targets  # sync scoped to this run's hosts
        return {"sync_id": 99, "status": "completed", "vulns_new": 5,
                "vulns_updated": 2, "vulns_closed": 3, "vulns_reopened": 1}

    SyncService.run_full_sync = staticmethod(_fake_run)
    # Stub the resolver so the credential-bearing run stays DB-free (fake creds).
    import sys
    _mod = sys.modules[__name__]
    orig_resolve = _mod._resolve_credentials
    _fake_creds = [{"type": "windows", "username": "svc", "password": "x", "domain": "CORP"}]
    _mod._resolve_credentials = lambda db, tid, ids: _fake_creds if ids else None
    try:
        result = run_hosted_scan(_DB(), 7, 1, credential_profile_ids=[1],
                                 poll_timeout_s=5, poll_interval_s=0.001)
    finally:
        SyncService.build_adapter, SyncService.run_full_sync = orig_build, orig_run
        _mod._resolve_credentials = orig_resolve

    assert result["status"] == "completed", result
    assert run.status == "completed" and run.nessus_scan_id == "42", (run.status, run.nessus_scan_id)
    assert run.progress == 100, run.progress
    assert run.vulns_new == 5 and run.vulns_total == 7, (run.vulns_new, run.vulns_total)
    assert run.vulns_closed == 3 and run.vulns_reopened == 1, (run.vulns_closed, run.vulns_reopened)
    assert calls == {"create": 1, "launch": 1, "detail": 3, "status": 3, "sync": 1}, calls
    # A credential-bearing run must hand create_scan the resolved list.
    assert captured["credentials"] == _fake_creds, captured
    # And the adapter must fold it into the Nessus settings.credentials block.
    from grc.modules.integrations.adapters.nessus_adapter import NessusAdapter
    _block = NessusAdapter._nessus_credentials(_fake_creds)
    assert _block["add"]["Host"]["Windows"][0]["username"] == "svc", _block
    assert NessusAdapter._nessus_credentials(None) is None
    # SNMP community → Nessus "Plaintext Authentication" / "SNMPv1/v2c" block.
    _snmp_block = NessusAdapter._nessus_credentials([{"type": "snmp", "community": "public"}])
    assert _snmp_block["add"]["Plaintext Authentication"]["SNMPv1/v2c"][0]["community_string"] == "public", _snmp_block
    # Windows + SNMP together in one block.
    _mix = NessusAdapter._nessus_credentials([{"type": "windows", "username": "svc", "password": "x"}, {"type": "snmp", "community": "c1"}])
    assert "Host" in _mix["add"] and "Plaintext Authentication" in _mix["add"], _mix
    # A session deleted mid-scan: the poller exits on its next tick without
    # touching Nessus, syncing, or committing onto the missing row.
    class _GoneDB(_DB):
        def query(self, model):
            return _Q(None if model is HostedScanRun else conn)
    _touched = {"n": 0}
    class _UntouchedAdapter:
        def get_scan_detail(self, sid):
            _touched["n"] += 1
            return {}
        def get_scan_status(self, sid):
            _touched["n"] += 1
            return "completed"
    _gdb = _GoneDB()
    _gone = _poll_and_sync(_gdb, run, 7, 1, _UntouchedAdapter(), 42, poll_interval_s=0.001, poll_timeout_s=5)
    assert _gone["status"] == "deleted" and _touched["n"] == 0 and _gdb.commits == 0, (_gone, _touched, _gdb.commits)
    # unit-check the progress parser independently
    assert _progress_from_detail({"hosts": [{"progress": "100/100"}, {"progress": "0/100"}]}) == (50, 2, 1)
    assert _progress_from_detail({}) == (None, None, None)
    # target normalization is order/space-insensitive so a re-scan matches
    assert _norm_targets(" 10.0.0.2, 10.0.0.1 ,10.0.0.1") == "10.0.0.1,10.0.0.2"
    # reuse lookup: a prior run on the same connection + same target set wins;
    # a different target set does not.
    class _PQ:
        def __init__(self, rows):
            self._rows = rows
        def filter(self, *a, **k):
            return self
        def order_by(self, *a, **k):
            return self
        def limit(self, n):
            return self
        def all(self):
            return self._rows
    class _PriorDB:
        def __init__(self, rows):
            self._rows = rows
        def query(self, m):
            return _PQ(self._rows)
    _prior = types.SimpleNamespace(id=1, targets="10.0.0.2, 10.0.0.1", nessus_scan_id="55")
    _new = types.SimpleNamespace(id=9, tenant_id=1, connection_id=1, targets="10.0.0.1,10.0.0.2")
    assert _find_reusable_scan_id(_PriorDB([_prior]), 1, _new) == "55"
    _new_other = types.SimpleNamespace(id=9, tenant_id=1, connection_id=1, targets="10.9.9.9")
    assert _find_reusable_scan_id(_PriorDB([_prior]), 1, _new_other) is None
    print("hosted_scan self-check OK:", result)


if __name__ == "__main__":
    _demo()
