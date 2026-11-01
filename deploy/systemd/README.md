# ComplyVerse register CVE enrichment sweep (MANUAL one-shot)

CVE enrichment (CVSS score+vector, EPSS, CISA-KEV, CWE) is now **event-driven**:

- a **scan enriches its own asset's findings at completion** (pentest
  `_run_scan_job`, and `classify_run` on "Find exploitable"), and
- opening a finding **lazy-enriches it** on the read path (`ensure_cve_enriched`).

Enrichment of a finding is a one-time thing, so there is **no recurring timer**.
The sweep below is a **manual ops CLI** for draining a *historical backlog* of
un-enriched register CVEs on demand (e.g. after importing old findings, or a
first pass over a register that predates per-scan enrichment). Run it by hand,
once; it exits cheaply when nothing is un-enriched.

- **Sweep:** `grc/modules/vuln_management/enrichment/sweep.py`
  (entrypoint `backend/scripts/enrich_sweep.py`)
- **Scope:** register only — `exclude_adhoc` (managed-inventory findings) +
  `nvd_last_synced_at IS NULL` + CVE-id prefix. Ad-hoc / unlinked / non-CVE rows
  are never touched (lazy-on-open still covers an ad-hoc finding someone opens).
- **Reuses** the shared `ensure_cve_enriched` path. No new data source/engine, no
  hardcoded CVE values.
- **Tenants** are enumerated from the master catalog (`grc_tenants`). Override
  with `ENRICH_SWEEP_TENANTS=slug1,slug2`.
- **Idempotent** (gated on `nvd_last_synced_at IS NULL`), **single-instance**
  (flock at `$ENRICH_SWEEP_LOCK`, default `/tmp/ava-enrich-sweep.lock`),
  **best-effort** (one bad CVE never aborts; never raises out).
- **Pacing:** ~6s per NEW distinct CVE unkeyed (NVD 5/30s); set `NVD_API_KEY` for
  ~0.7s (50/30s). Repeats are served from the 7-day Redis cache (no sleep).

## Run a one-time backlog fill on the box

```sh
cd /root/ComplyVerse/backend
PYTHONPATH=/root/ComplyVerse/backend venv/bin/python scripts/enrich_sweep.py
```

A full drain of ~400 register CVEs takes ~40 min unkeyed (6s/CVE) or ~5 min with
an `NVD_API_KEY` (0.7s/CVE). Once drained, re-running finds 0 un-enriched and
exits in seconds. You should not need to re-run it: new findings enrich
themselves at scan completion / on first open.

## Removing the old recurring timer (if it was installed)

The previous `ava-enrich-sweep.timer` / `.service` units have been removed from
the repo. If a box still has them installed, stop, disable and delete them:

```sh
sudo systemctl disable --now ava-enrich-sweep.timer
sudo rm /etc/systemd/system/ava-enrich-sweep.{service,timer}
sudo systemctl daemon-reload
```
