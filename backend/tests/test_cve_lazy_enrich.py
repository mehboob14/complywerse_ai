"""READ-path lazy enrichment: opening an un-enriched CVE finding self-heals it.

Root gap: enrich_vulnerability only ran inside classify_run, so any finding whose run was never
(re-)classified kept CVSS/EPSS/KEV/CWE NULL — the Analysis "Before" read blank for the whole register.
The fix is ensure_cve_enriched(db, vuln): a guarded one-shot enrich at the detail/intel read chokepoints.
These lock the gate (real CVE + never-synced), that an already-enriched or non-CVE row is left untouched
(no re-fetch / honest empty), and that an enrichment exception never breaks the read. Offline: sqlite,
enrich_vulnerability spied. ponytail: one helper, three callers — tested once here.
"""
import datetime as _dt

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Vulnerability
from grc.modules.vuln_management.enrichment import ensure_cve_enriched


def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Vulnerability.__table__.create(eng, checkfirst=True)
    return sessionmaker(bind=eng)()


_seq = iter(range(1, 10_000))


def _row(db, *, cve_id, synced=None):
    vid = f"V-{next(_seq)}"  # unique: (tenant_id, vuln_id) is a UNIQUE constraint
    v = Vulnerability(tenant_id=1, vuln_id=vid, title=vid, severity="high",
                      source="ai-pentest:nmap", cve_id=cve_id, nvd_last_synced_at=synced)
    db.add(v); db.commit()
    return v


def _spy(monkeypatch):
    calls = []
    # Patch at enrichment_service (where ensure_cve_enriched binds the name), not the package alias.
    monkeypatch.setattr(
        "grc.modules.vuln_management.enrichment.enrichment_service.enrich_vulnerability",
        lambda v, d: calls.append(v.cve_id),
    )
    return calls


def test_unsynced_cve_triggers_enrichment_once(monkeypatch):
    db = _db()
    v = _row(db, cve_id="CVE-2024-21450")
    calls = _spy(monkeypatch)
    assert ensure_cve_enriched(db, v) is True
    assert calls == ["CVE-2024-21450"]  # ran exactly once, gated on nvd_last_synced_at IS NULL


def test_already_enriched_row_is_not_refetched(monkeypatch):
    db = _db()
    v = _row(db, cve_id="CVE-2024-21450", synced=_dt.datetime.utcnow())
    calls = _spy(monkeypatch)
    assert ensure_cve_enriched(db, v) is False
    assert calls == []  # steady state: no per-request NVD call


def test_non_cve_row_is_skipped(monkeypatch):
    db = _db()
    calls = _spy(monkeypatch)
    assert ensure_cve_enriched(db, _row(db, cve_id="GHSA-xxxx-yyyy-zzzz")) is False
    assert ensure_cve_enriched(db, _row(db, cve_id=None)) is False
    assert calls == []  # honest empty state, never fabricated


def test_enrich_exception_does_not_break_the_read(monkeypatch):
    db = _db()
    v = _row(db, cve_id="CVE-2024-0001")

    def _boom(vuln, d):
        raise RuntimeError("NVD blew up")
    monkeypatch.setattr(
        "grc.modules.vuln_management.enrichment.enrichment_service.enrich_vulnerability", _boom)

    assert ensure_cve_enriched(db, v) is False  # swallowed; caller returns the row as-is
