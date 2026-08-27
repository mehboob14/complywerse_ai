import ipaddress
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from grc.models import (
    IntegrationConnection,
    IntegrationAuditLog,
    ITAsset,
    ScanRecord,
    SyncHistory,
    Vulnerability,
    VulnerabilityAssetLink,
    VulnerabilitySolution,
)
from ..adapters.base_adapter import BaseAdapter, ConnectionTestResult
from ..adapters.adapter_factory import build_adapter, get_transformer
from grc.services.cpe_matcher import connection_auto_link_enabled

logger = logging.getLogger(__name__)
DEBUG_PAYLOADS = os.environ.get("INTEGRATIONS_DEBUG_PAYLOADS", "true").lower() == "true"


class SyncService:

    @staticmethod
    def _debug_shape(label: str, payload: Any):
        if not DEBUG_PAYLOADS:
            return
        try:
            if isinstance(payload, dict):
                logger.info("INTEGRATIONS_DEBUG %s dict_keys=%s", label, sorted(list(payload.keys())))
            elif isinstance(payload, list):
                sample_keys = sorted(list(payload[0].keys())) if payload and isinstance(payload[0], dict) else []
                logger.info("INTEGRATIONS_DEBUG %s list_count=%s sample_keys=%s", label, len(payload), sample_keys)
            else:
                logger.info("INTEGRATIONS_DEBUG %s payload_type=%s", label, type(payload).__name__)
        except Exception as e:
            logger.warning("INTEGRATIONS_DEBUG failed for %s: %s", label, e)

    @staticmethod
    def _map_asset_fields(transformed: Dict[str, Any]) -> Dict[str, Any]:
        critical = transformed.get("critical_vulns", 0) or 0
        severe = transformed.get("severe_vulns", 0) or 0
        # NOTE: criticality is deliberately NOT derived here and is not part of
        # the mapped fields below.
        #
        # Asset criticality is BUSINESS importance — the harm if this asset is
        # compromised, from its C/I/A ratings, data classification and business
        # function. It is not a count of findings. Deriving it from vulnerability
        # severity said "this laptop has critical CVEs, therefore this laptop is
        # a critical asset", which is a different claim entirely, and because the
        # update loop setattr()s mapped fields it also OVERWROTE ratings a human
        # had set. The vulnerability counts still reach the asset — as
        # vulnerabilities, which is what they are.

        lines = [
            "Auto-synced from vulnerability scanner",
            f"Scanner source: {transformed.get('scanner_source', 'unknown')}",
            f"External asset id: {transformed.get('external_asset_id', '')}",
            f"Total vulnerabilities: {transformed.get('total_vulns', 0)}",
            f"Critical: {critical}, High: {severe}, Medium: {transformed.get('moderate_vulns', 0) or 0}",
        ]

        # Normalise the scanner's raw OS string (e.g. "Microsoft Windows
        # Server 2019") into the canonical os_normalized key the CIS rule
        # matcher expects. Previously this string was captured by the
        # transformer but dropped here, leaving scanner assets with
        # os_normalized=NULL and invisible to every OS-specific benchmark.
        raw_os = transformed.get("operating_system") or ""
        os_family = os_normalized = os_build = os_edition = None
        if raw_os:
            try:
                from grc.modules.compliance_plugins.services.os_detector import normalize_os_string
                os_family, os_normalized, os_build, os_edition = normalize_os_string(raw_os)
            except Exception:  # noqa: BLE001 — normalisation must never break a sync
                logger.exception("normalize_os_string failed for %r", raw_os)

        return {
            "name": transformed.get("name") or transformed.get("host_name") or transformed.get("ip_address") or "Scanner Asset",
            "asset_type": "infrastructure",
            "host_name": transformed.get("host_name") or None,
            "ip_address": transformed.get("ip_address") or None,
            "status": "active",
            "description": "\n".join(lines),
            "vendor": transformed.get("scanner_source") or None,
            "location": transformed.get("nexpose_site") or None,
            "os_family": os_family,
            "os_version": raw_os or None,
            "os_normalized": os_normalized,
            "os_build": os_build,
            "os_edition": os_edition,
        }

    @staticmethod
    def _map_vulnerability_fields(transformed: Dict[str, Any]) -> Dict[str, Any]:
        discovered_at = transformed.get("first_detected") or transformed.get("last_seen") or datetime.utcnow()
        return {
            "vuln_id": transformed.get("vuln_id"),
            "title": transformed.get("title") or "Scanner Finding",
            "description": transformed.get("description") or "",
            "severity": transformed.get("severity") or "medium",
            "cvss_score": transformed.get("cvss_score"),
            "cvss_vector": transformed.get("cvss_vector"),
            "cve_id": transformed.get("cve_id"),
            "cwe_id": transformed.get("cwe_id"),
            "cwe_ids": transformed.get("cwe_ids"),
            "affected_host": transformed.get("affected_host"),
            "plugin_family": transformed.get("plugin_family"),
            "vpr_score": transformed.get("vpr_score"),
            "cpe": transformed.get("cpe"),
            "evidence": transformed.get("proof"),
            "status": transformed.get("status") or "open",
            "discovered_at": discovered_at,
            "updated_at": datetime.utcnow(),
            # Scanner closure loop — provenance + observation window. These
            # feed the auto-close/reopen engine; on updates they are handled
            # specially in the sync loop (last_seen only advances, status is
            # never blanket-overwritten).
            "connection_id": transformed.get("connection_id"),
            "source": transformed.get("source"),
            "external_vuln_id": transformed.get("external_vuln_id"),
            "scanner_status": transformed.get("scanner_status") or "present",
            "first_detected": transformed.get("first_detected"),
            "last_seen": transformed.get("last_seen"),
            "last_seen_scan_id": transformed.get("last_seen_scan_id"),
        }

    @staticmethod
    def build_adapter(connection: IntegrationConnection) -> BaseAdapter:
        return build_adapter(connection)

    @staticmethod
    def test_connection(db: Session, connection_id: int, tenant_id: int) -> ConnectionTestResult:
        connection = db.query(IntegrationConnection).filter(
            IntegrationConnection.id == connection_id,
            IntegrationConnection.tenant_id == tenant_id,
        ).first()
        if not connection:
            return ConnectionTestResult(success=False, message="Connection not found")

        adapter = SyncService.build_adapter(connection)
        result = adapter.test_connection()

        connection.status = "connected" if result.success else "error"
        connection.updated_at = datetime.utcnow()
        db.commit()

        SyncService._audit(db, tenant_id, "connection", connection.id, "test_connection",
                           details={"success": result.success, "message": result.message})

        return result

    @staticmethod
    def run_full_sync(
        db: Session,
        connection_id: int,
        tenant_id: int,
        triggered_by_user_id: Optional[int] = None,
        sync_type: str = "manual",
    ) -> Dict[str, Any]:
        connection = db.query(IntegrationConnection).filter(
            IntegrationConnection.id == connection_id,
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.is_active == True,
        ).first()
        if not connection:
            raise ValueError("Connection not found or inactive")

        history = SyncHistory(
            tenant_id=tenant_id,
            connection_id=connection_id,
            sync_type=sync_type,
            triggered_by_user_id=triggered_by_user_id,
            started_at=datetime.utcnow(),
            status="running",
        )
        db.add(history)
        db.commit()
        db.refresh(history)

        adapter = SyncService.build_adapter(connection)
        stats = {
            "assets_new": 0, "assets_updated": 0, "assets_unchanged": 0,
            "vulns_new": 0, "vulns_updated": 0, "vulns_closed": 0, "vulns_reopened": 0,
            "vulns_enriched": 0,
            "solutions_synced": 0, "scans_synced": 0, "errors_count": 0,
            "error_details": [],
        }

        try:
            synced_assets = SyncService._sync_assets(db, adapter, connection, tenant_id, stats)
            SyncService._sync_vulnerabilities(db, adapter, connection, tenant_id, stats, synced_assets=synced_assets)
            SyncService._sync_scans(db, adapter, connection, tenant_id, stats)

            # ── Auto-enrich CVE-bearing vulns (NVD CWE + EPSS + KEV) ──────────
            # The per-vuln dispatch above uses Celery (.delay), which silently
            # does nothing when no worker is running — which is how imported
            # findings ended up with blank CWE/EPSS. run_full_sync itself
            # executes in a background daemon thread (see integrations/router.py),
            # so we can enrich SYNCHRONOUSLY here without a worker and without
            # blocking the request or hitting the /api proxy timeout. This is
            # self-healing: any CVE vuln still missing enrichment (from this or a
            # prior sync, for any reason) is picked up on the next sync. Runs
            # BEFORE composite scoring below so priorities use the fresh EPSS/KEV.
            try:
                from grc.modules.vuln_management.enrichment import enrich_vulnerability
                _eq = db.query(Vulnerability).filter(
                    Vulnerability.tenant_id == tenant_id,
                    Vulnerability.cve_id.isnot(None),
                    or_(Vulnerability.cwe_id.is_(None), Vulnerability.epss_score.is_(None)),
                )
                if hasattr(Vulnerability, "connection_id"):
                    _eq = _eq.filter(Vulnerability.connection_id == connection.id)
                _todo = _eq.all()
                _enr_ok = 0
                for _v in _todo:
                    try:
                        enrich_vulnerability(_v, db)
                        _enr_ok += 1
                    except Exception:
                        logger.exception(
                            "post-sync auto-enrich failed for vuln %s (non-fatal)",
                            getattr(_v, "id", "?"),
                        )
                if _todo:
                    logger.info(
                        "post-sync enrichment: %d/%d CVE vulns enriched (conn=%s)",
                        _enr_ok, len(_todo), connection.id,
                    )
                stats["vulns_enriched"] = _enr_ok
            except Exception:
                logger.exception("post-sync enrichment block failed (non-fatal)")

            # Score every synced vuln from its stored signals so freshly-imported
            # findings carry the correct composite priority immediately, instead of
            # sitting at 0 until the next enrichment (which made the Remediation
            # plan read "0/100" while the Analysis tab computed the real score).
            try:
                from grc.modules.vuln_management.enrichment.enrichment_service import (
                    recompute_composite_priority,
                )
                _vq = db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id)
                if hasattr(Vulnerability, "connection_id"):
                    _vq = _vq.filter(Vulnerability.connection_id == connection.id)
                for _v in _vq.all():
                    try:
                        recompute_composite_priority(_v, db)
                    except Exception:
                        pass
                db.commit()
            except Exception:
                logger.exception("post-sync composite scoring failed (non-fatal)")

            # ── Choke-point recompute (Phase 4) ───────────────────────────────
            # Reachability may have shifted this sync (new findings, closures),
            # so refresh the ranking + stamp first-appearance. Best-effort:
            # a failure never fails the sync (the ranking is recomputable and
            # explicit-recompute exists on the API).
            try:
                from grc.services.choke_points import persist_snapshot
                persist_snapshot(db, tenant_id)
                db.commit()
            except Exception:
                logger.exception("post-sync choke-point recompute failed (non-fatal)")
                db.rollback()

            # ── CTEM Validate mapping is NO LONGER run here ───────────────────
            # Control mapping is Validate-stage work, not Discover-stage work.
            # Running it during the sync made the whole CTEM loop look pre-baked
            # (every stage "already done" the moment a scope opened). It now runs
            # ON DEMAND when the operator reaches the Validate stage and clicks
            # "Map controls" — POST /vuln-management/ai-control-proposals/generate
            # (scope-aware, background, polled by AiControlProposalsPanel). Sync
            # is pure Discover: import findings + enrich; nothing maps controls.

            # ── Outbound write-back retry ─────────────────────────────────────
            # Push (or record-as-skipped) any pending/failed GRC→scanner
            # decision actions for this connection. Runs in this background
            # thread, same self-healing discipline as enrichment: a broken
            # push never fails the sync and is retried next sync.
            try:
                from .writeback_service import WritebackService
                WritebackService.process_pending(db, connection, tenant_id)
            except Exception:
                logger.exception("post-sync scanner write-back processing failed (non-fatal)")

            history.status = "completed"
            connection.last_sync_status = "success"
            connection.consecutive_failures = 0
            # A completed sync IS proof the connection is live — flip a freshly created
            # "pending" (or a recovered "error") connection to "connected" so the status
            # badge stops lagging behind a successful pull.
            if connection.status != "deactivated":
                connection.status = "connected"
        except Exception as e:
            logger.exception(f"Sync failed for connection {connection_id}: {e}")
            history.status = "failed"
            stats["errors_count"] += 1
            stats["error_details"].append({"phase": "general", "error": str(e)[:500]})
            connection.last_sync_status = "failed"
            # Surface the failure on the status badge too (mirrors the success
            # path flipping it to "connected"), so a broken sync doesn't keep
            # showing a stale "connected" pill.
            if connection.status != "deactivated":
                connection.status = "error"
            connection.consecutive_failures = (connection.consecutive_failures or 0) + 1
        finally:
            now = datetime.utcnow()
            history.completed_at = now
            history.duration_ms = int((now - history.started_at).total_seconds() * 1000)
            history.assets_new = stats["assets_new"]
            history.assets_updated = stats["assets_updated"]
            history.assets_unchanged = stats["assets_unchanged"]
            history.vulns_new = stats["vulns_new"]
            history.vulns_updated = stats["vulns_updated"]
            history.vulns_closed = stats["vulns_closed"]
            if hasattr(history, "vulns_reopened"):
                history.vulns_reopened = stats.get("vulns_reopened", 0)
            history.errors_count = stats["errors_count"]
            history.error_details = stats["error_details"] if stats["error_details"] else None

            connection.last_sync_at = now
            connection.last_sync_stats = {
                k: v for k, v in stats.items() if k != "error_details"
            }
            db.commit()

        SyncService._audit(db, tenant_id, "sync", history.id, "full_sync",
                           performed_by_user_id=triggered_by_user_id,
                           details={"status": history.status, "stats": connection.last_sync_stats})

        return {
            "sync_id": history.id,
            "status": history.status,
            "duration_ms": history.duration_ms,
            **{k: v for k, v in stats.items() if k != "error_details"},
        }

    @staticmethod
    def _host_variants(*names: Optional[str]) -> set:
        """Normalised name forms for host matching: lower-cased, whitespace- and
        trailing-dot-stripped, plus the short label (the part before the first dot).

        So a scanner FQDN ``WEB01.corp.local`` yields ``{web01.corp.local, web01}`` and
        matches an inventory asset stored as either the FQDN or the short ``web01`` —
        the case that exact matching silently missed.
        """
        out: set = set()
        for n in names:
            if not n:
                continue
            v = str(n).strip().lower().rstrip(".")
            if not v:
                continue
            out.add(v)
            short = v.split(".", 1)[0]
            if short:
                out.add(short)
        return out

    @staticmethod
    def _find_existing_asset(
        db: Session,
        tenant_id: int,
        *,
        host_name: Optional[str],
        ip_address: Optional[str],
        name: Optional[str],
    ) -> Optional[ITAsset]:
        """Match a scanned host to an existing ITAsset — name-first, IP last.

        Order is deliberate and DHCP-safe: a hostname / FQDN is a stable identity, an
        IP is not (it can be re-leased to a different host between scans), so IP is only
        a last resort. Matching is case-insensitive and compares the scanned name (and
        its short label) against BOTH the asset's ``host_name`` and ``fqdn`` columns, so
        discovery-registered assets and scanner findings converge on ONE asset instead
        of drifting apart on ``WEB01`` vs ``web01.corp.local``.

        Never fuzzy beyond the short-label equivalence above, and never creates an
        asset — a miss returns None and the caller leaves the finding unlinked.
        """
        variants = SyncService._host_variants(host_name, name)
        if variants:
            existing = db.query(ITAsset).filter(
                ITAsset.tenant_id == tenant_id,
                or_(
                    func.lower(ITAsset.host_name).in_(variants),
                    func.lower(ITAsset.fqdn).in_(variants),
                ),
            ).first()
            if existing:
                return existing
        if ip_address:
            existing = db.query(ITAsset).filter(
                ITAsset.tenant_id == tenant_id,
                ITAsset.ip_address == ip_address,
            ).first()
            if existing:
                return existing
        return None

    @staticmethod
    def _ip_alias_assets(db: Session, tenant_id: int, ip_address: str, primary_asset_id: int) -> List[ITAsset]:
        """Machine-type assets that are the same scanned box under another name.

        Only called for hosts the scanner knew by BARE IP (no resolvable name):
        every inventory asset carrying exactly that IP that is itself a
        machine/surface record (infrastructure / cloud) is a DNS alias of the
        scanned server, so its findings apply to each of them. Application,
        data and third_party assets are never included — co-located software
        must not inherit the host's findings. Name-known hosts never fan out
        at all: a real hostname identifies ONE asset.
        """
        return db.query(ITAsset).filter(
            ITAsset.tenant_id == tenant_id,
            ITAsset.ip_address == ip_address,
            ITAsset.id != primary_asset_id,
            ITAsset.asset_type.in_(("infrastructure", "cloud")),
        ).all()

    @staticmethod
    def _sync_assets(
        db: Session,
        adapter: BaseAdapter,
        connection: IntegrationConnection,
        tenant_id: int,
        stats: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        transformer = get_transformer(connection.integration_type)
        logger.info(f"Syncing assets for connection {connection.id} (type={connection.integration_type})")
        all_assets = adapter._paginate_all(adapter.get_assets, page_size=500)
        logger.info(f"Fetched {len(all_assets)} assets from {connection.integration_type}")
        SyncService._debug_shape("sync_assets.raw_assets", all_assets)
        synced_assets: List[Dict[str, Any]] = []

        for raw_asset in all_assets:
            try:
                SyncService._debug_shape("sync_assets.raw_asset", raw_asset)
                transformed = transformer.transform_asset(raw_asset, connection.id, tenant_id)
                SyncService._debug_shape("sync_assets.transformed_asset", transformed)
                ext_id = transformed.get("external_asset_id") or ""
                mapped_asset = SyncService._map_asset_fields(transformed)

                host_name = mapped_asset.get("host_name")
                ip_address = mapped_asset.get("ip_address")
                name = mapped_asset.get("name")
                existing = SyncService._find_existing_asset(
                    db, tenant_id, host_name=host_name, ip_address=ip_address, name=name,
                )

                # Phase 5.5 — Tag every sync with where + when we last saw this
                # asset. Used by the UI stale filter and by future analytics.
                # Wrapped in a getattr guard so the bump silently no-ops if the
                # column migration hasn't yet applied for this tenant DB.
                _now = datetime.utcnow()
                _source_label = (connection.integration_type or "scanner").lower()

                if existing:
                    changed = False
                    for key, val in mapped_asset.items():
                        if val is None:
                            continue
                        current = getattr(existing, key, None)
                        # An IP literal in a name field is an address, not an
                        # identity. When the scanner knew the host only by its
                        # IP (so the transformed host_name IS the IP), never
                        # let it stomp a real host_name/fqdn on the matched
                        # asset — discovery/EASM owns those fields. The IP
                        # itself still lands in ip_address as usual.
                        if key in ("host_name", "fqdn") and current and current != val:
                            try:
                                ipaddress.ip_address(str(val).strip())
                                continue
                            except ValueError:
                                pass
                        # Keep manually edited display names for scanner-fetched assets.
                        if key == "name" and current and current != val:
                            # When the scanner knew the host only by its IP,
                            # the "name" it reports is just the scan's label
                            # (e.g. "liztek server"), not a host identity —
                            # never rename an asset with it.
                            _scanned_host = mapped_asset.get("host_name")
                            if _scanned_host:
                                try:
                                    ipaddress.ip_address(str(_scanned_host).strip())
                                    continue
                                except ValueError:
                                    pass
                            auto_name_candidates = {
                                getattr(existing, "ip_address", None),
                                getattr(existing, "host_name", None),
                            }
                            is_auto = any(
                                current == c for c in auto_name_candidates if c
                            ) or current.startswith("Nessus-Host-")
                            if not is_auto:
                                continue
                        if current != val:
                            setattr(existing, key, val)
                            changed = True
                    # Bump last-seen regardless of whether other fields changed —
                    # the asset is still being observed, even if nothing differs.
                    if hasattr(existing, "last_seen_at"):
                        existing.last_seen_at = _now
                        existing.last_seen_source = _source_label
                    if changed:
                        if hasattr(existing, "updated_at"):
                            existing.updated_at = datetime.utcnow()
                        stats["assets_updated"] += 1
                    if not changed:
                        stats["assets_unchanged"] += 1
                    # When the scanner knew this host only by bare IP, its
                    # findings also belong on every other machine-type asset
                    # carrying that exact IP (DNS aliases of the same server).
                    alias_assets: List[ITAsset] = []
                    if ip_address and host_name:
                        try:
                            ipaddress.ip_address(str(host_name).strip())
                            alias_assets = SyncService._ip_alias_assets(
                                db, tenant_id, ip_address, existing.id
                            )
                        except ValueError:
                            pass
                    synced_assets.append({
                        "asset": existing,
                        "alias_assets": alias_assets,
                        "external_asset_id": ext_id,
                        "host_name": host_name or "",
                        "ip_address": ip_address or "",
                    })
                else:
                    # A scanner import does NOT create inventory. IT Asset
                    # Inventory is populated by discovery, and only after a
                    # credential authenticated and the host was profiled —
                    # a scan result is evidence about a host, not proof we
                    # own or manage it. Creating one here produced shell
                    # assets with no OS, no hardware and no owner, which then
                    # counted as devices and carried risk scores.
                    #
                    # The host is still carried forward with asset=None so its
                    # vulnerabilities are imported into the vulnerability
                    # module as normal; they simply aren't linked to an asset
                    # until that host legitimately enters inventory.
                    stats["assets_unmatched"] = stats.get("assets_unmatched", 0) + 1
                    synced_assets.append({
                        "asset": None,
                        "external_asset_id": ext_id,
                        "host_name": host_name or "",
                        "ip_address": ip_address or "",
                    })

            except Exception as e:
                logger.error(f"Error syncing asset {raw_asset.get('id')}: {e}")
                stats["errors_count"] += 1
                stats["error_details"].append({
                    "phase": "assets", "asset_id": raw_asset.get("id"), "error": str(e)[:300]
                })

        db.flush()
        return synced_assets

    @staticmethod
    def _sync_vulnerabilities(
        db: Session,
        adapter: BaseAdapter,
        connection: IntegrationConnection,
        tenant_id: int,
        stats: Dict[str, Any],
        synced_assets: Optional[List[Dict[str, Any]]] = None,
    ):
        transformer = get_transformer(connection.integration_type)
        integration_type = (connection.integration_type or "nexpose").lower()
        is_nessus = integration_type in ("nessus", "tenable")
        # Resolve the auto-link switch ONCE for the whole run (per-connection, default
        # ON) so every finding in this sync is linked consistently.
        link_assets = connection_auto_link_enabled(connection)
        logger.info(f"Syncing vulnerabilities for connection {connection.id} (type={integration_type})")

        if synced_assets is None:
            fallback_assets = db.query(ITAsset).filter(
                ITAsset.tenant_id == tenant_id,
                ITAsset.status == "active",
            ).all()
            synced_assets = [{
                "asset": a,
                "external_asset_id": "",
                "host_name": getattr(a, "host_name", "") or "",
                "ip_address": getattr(a, "ip_address", "") or "",
            } for a in fallback_assets]

        # Resolve the tenant's slug ONCE so we can fan out async enrichment
        # tasks per new/updated vuln. If anything goes wrong here, enrichment
        # is silently skipped for this sync — the sync itself still succeeds
        # and the daily Celery refresh will catch the un-enriched rows.
        tenant_slug_for_enrich: Optional[str] = None
        try:
            from ...db import MasterSession  # local import — avoids circulars
            from ...models import Tenant as _MasterTenant
            _m = MasterSession()
            try:
                _row = _m.query(_MasterTenant.slug).filter(_MasterTenant.id == tenant_id).first()
                tenant_slug_for_enrich = _row[0] if _row else None
            finally:
                _m.close()
        except Exception:
            logger.warning("Could not resolve tenant slug for enrichment (tenant_id=%s)", tenant_id)

        seen_vuln_ids = set()
        vuln_detail_cache: Dict[str, Dict] = {}
        # Per-host bookkeeping for the closure engine: which finding ids this
        # sync actually saw for each host, and whether the host's pull was
        # clean. A host whose fetch failed (or was degraded by a per-instance
        # error) is EXCLUDED from closure — "we couldn't read it" must never
        # become "it's fixed".
        host_contexts: List[Dict[str, Any]] = []

        for asset_ref in synced_assets:
            asset = asset_ref.get("asset")
            external_asset_id = asset_ref.get("external_asset_id") or getattr(asset, "host_name", "") or getattr(asset, "ip_address", "") or getattr(asset, "name", "")
            host_ctx: Dict[str, Any] = {
                "ext_id": external_asset_id,
                "host_name": asset_ref.get("host_name", "") or (getattr(asset, "host_name", "") or ""),
                "ip_address": asset_ref.get("ip_address", "") or (getattr(asset, "ip_address", "") or ""),
                "seen_ids": set(),
                # Scanner-native plugin ids seen for this host — the second,
                # identity-drift-proof absence check for closure.
                "seen_plugins": set(),
                "fetch_failed": False,
                "degraded": False,
            }
            host_contexts.append(host_ctx)
            try:
                if is_nessus:
                    instances = adapter.get_asset_vulnerabilities(
                        external_asset_id,
                        hostname=host_ctx["host_name"],
                        ip_address=host_ctx["ip_address"],
                    )
                else:
                    instances = adapter.get_asset_vulnerabilities(external_asset_id)
                SyncService._debug_shape(f"sync_vulns.instances.asset_{getattr(asset, 'id', None)}", instances)
            except Exception as e:
                logger.error(f"Error fetching vulns for asset {getattr(asset, 'id', None)}: {e}")
                host_ctx["fetch_failed"] = True
                stats["errors_count"] += 1
                continue

            for instance in instances:
                try:
                    if is_nessus:
                        ext_vuln_id = str(instance.get("plugin_id", ""))
                    else:
                        ext_vuln_id = str(instance.get("id", ""))
                    if not ext_vuln_id:
                        continue

                    if is_nessus:
                        scan_id = instance.get("_scan_id", "")
                        host_id = instance.get("_host_id", "")
                        if scan_id and host_id:
                            cache_key = f"{scan_id}:{host_id}:{ext_vuln_id}"
                            if cache_key not in vuln_detail_cache:
                                try:
                                    vuln_detail_cache[cache_key] = adapter.get_vulnerability_detail(f"{scan_id}:{host_id}:{ext_vuln_id}")
                                except Exception:
                                    vuln_detail_cache[cache_key] = {"plugin_id": ext_vuln_id}
                            detail = vuln_detail_cache[cache_key]
                        else:
                            cache_key = f"plugin:{ext_vuln_id}"
                            if cache_key not in vuln_detail_cache:
                                try:
                                    vuln_detail_cache[cache_key] = adapter.get_plugin_detail(ext_vuln_id)
                                except Exception:
                                    vuln_detail_cache[cache_key] = {"id": ext_vuln_id}
                            detail = vuln_detail_cache[cache_key]
                        merged = {**instance, **detail}
                        SyncService._debug_shape("sync_vulns.nessus_merged", merged)
                        transformed = transformer.transform_vulnerability(
                            merged, external_asset_id, connection.id, tenant_id,
                        )
                    else:
                        if ext_vuln_id not in vuln_detail_cache:
                            try:
                                vuln_detail_cache[ext_vuln_id] = adapter.get_vulnerability_detail(ext_vuln_id)
                            except Exception:
                                vuln_detail_cache[ext_vuln_id] = {"id": ext_vuln_id}
                        detail = vuln_detail_cache[ext_vuln_id]
                        transformed = transformer.transform_vulnerability(
                            detail, instance, external_asset_id, connection.id, tenant_id,
                        )
                    SyncService._debug_shape("sync_vulns.transformed", transformed)

                    mapped_vuln = SyncService._map_vulnerability_fields(transformed)
                    # Stamp the scanned machine's REAL identity on the finding so it can
                    # auto-link to its asset if that asset only enters the inventory
                    # LATER (deep_collect.link_orphan_vulns_to_asset matches on this).
                    # affected_host is left alone — it is the scanner's internal id and
                    # is load-bearing for the stable vuln_id and auto-close.
                    _hid = {k: v for k, v in (
                        ("host_name", host_ctx.get("host_name")),
                        ("ip", host_ctx.get("ip_address")),
                    ) if v}
                    if _hid:
                        mapped_vuln["host_identity"] = _hid
                    gen_vuln_id = mapped_vuln["vuln_id"]
                    seen_vuln_ids.add(gen_vuln_id)
                    host_ctx["seen_ids"].add(gen_vuln_id)
                    host_ctx["seen_plugins"].add(str(ext_vuln_id))

                    existing = db.query(Vulnerability).filter(
                        Vulnerability.tenant_id == tenant_id,
                        Vulnerability.vuln_id == gen_vuln_id,
                    ).first()

                    if existing:
                        changed = False
                        # status and the observation-window fields are OWNED by
                        # the closure/reopen engine below, not blanket-copied.
                        # (The old loop wrote status="open" over accepted/
                        # false_positive on every sync — a live clobber bug.)
                        skip_fields = {
                            "tenant_id", "vuln_id", "created_at", "status",
                            "discovered_at", "first_detected", "last_seen",
                            "last_seen_scan_id", "scanner_status",
                        }
                        for key, val in mapped_vuln.items():
                            if key in skip_fields or val is None:
                                continue
                            current = getattr(existing, key, None)
                            if current != val:
                                setattr(existing, key, val)
                                changed = True

                        # Observation window: first_detected backfills once,
                        # last_seen only ADVANCES (re-syncing the same scan
                        # data is a no-op, so closure math stays idempotent),
                        # and the advancing run's scan id rides along.
                        new_seen = mapped_vuln.get("last_seen")
                        if getattr(existing, "first_detected", None) is None and mapped_vuln.get("first_detected"):
                            existing.first_detected = mapped_vuln["first_detected"]
                        prev_seen = getattr(existing, "last_seen", None)
                        if new_seen and (prev_seen is None or new_seen > prev_seen):
                            existing.last_seen = new_seen
                            if mapped_vuln.get("last_seen_scan_id"):
                                existing.last_seen_scan_id = mapped_vuln["last_seen_scan_id"]
                        elif getattr(existing, "last_seen_scan_id", None) is None and mapped_vuln.get("last_seen_scan_id"):
                            existing.last_seen_scan_id = mapped_vuln["last_seen_scan_id"]
                        if getattr(existing, "scanner_status", None) != "present":
                            existing.scanner_status = "present"

                        # Reopen: the scanner re-detected a finding we hold as
                        # fixed/closed — but only when the sighting is NEWER
                        # than the close/resolve decision. Without that guard a
                        # sync running minutes after an engineer marks a fix
                        # "remediated" would reopen it off STALE scan data from
                        # before the fix. Decision states (accepted / FP /
                        # decommission-closed) are never scanner-overridden.
                        _reopenable = {"auto_closed_fixed", "remediated", "resolved", "verified", "closed"}
                        if existing.status in _reopenable:
                            decision_time = getattr(existing, "closed_at", None) or existing.resolved_at
                            if new_seen is not None and (decision_time is None or new_seen > decision_time):
                                prior_status = existing.status
                                existing.status = "open"
                                existing.reopened_at = datetime.utcnow()
                                existing.reopen_count = (getattr(existing, "reopen_count", 0) or 0) + 1
                                _stamp = (
                                    f"[{datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}] Reopened: "
                                    f"scan {mapped_vuln.get('last_seen_scan_id') or '?'} re-detected this "
                                    f"finding (was '{prior_status}')."
                                )
                                existing.resolution_notes = (
                                    f"{existing.resolution_notes}\n\n{_stamp}"
                                    if existing.resolution_notes else _stamp
                                )
                                stats["vulns_reopened"] = stats.get("vulns_reopened", 0) + 1
                                changed = True
                                # CTEM Phase 2: re-detection after a claimed fix
                                # is a FAIL signal on the linked controls — a
                                # recent fail dominates older passes in the
                                # assurance tier.
                                try:
                                    from grc.services.control_assurance import record_vuln_evidence
                                    record_vuln_evidence(
                                        db, existing, source_type="scanner_closure",
                                        result="fail", tested_at=new_seen,
                                        details={"event": "reopened",
                                                 "scan_id": mapped_vuln.get("last_seen_scan_id"),
                                                 "was_status": prior_status,
                                                 "vuln_id": existing.vuln_id},
                                    )
                                except Exception:
                                    logger.exception("reopen evidence write failed (non-fatal)")

                        if changed:
                            existing.updated_at = datetime.utcnow()
                            stats["vulns_updated"] += 1
                    else:
                        vuln = Vulnerability(tenant_id=tenant_id, **mapped_vuln)
                        db.add(vuln)
                        stats["vulns_new"] += 1

                    db.flush()

                    db_vuln = db.query(Vulnerability).filter(
                        Vulnerability.tenant_id == tenant_id,
                        Vulnerability.vuln_id == gen_vuln_id,
                    ).first()
                    # Auto-link the finding to its scanned host — ON by default for a
                    # scanner feed (per-connection `link_assets`; toggle in the connect
                    # wizard). An UNMATCHED host still gets its vulnerability rows; they
                    # stay unlinked rather than inventing an asset to attach them to.
                    # Enrichment below runs regardless of linking.
                    if db_vuln and asset is not None:
                        if link_assets:
                            # Primary match plus its same-IP DNS aliases (only
                            # populated for hosts the scanner knew by bare IP).
                            for _target in [asset] + (asset_ref.get("alias_assets") or []):
                                existing_link = db.query(VulnerabilityAssetLink).filter(
                                    VulnerabilityAssetLink.vulnerability_id == db_vuln.id,
                                    VulnerabilityAssetLink.asset_id == _target.id,
                                ).first()
                                if not existing_link:
                                    db.add(VulnerabilityAssetLink(
                                        vulnerability_id=db_vuln.id,
                                        asset_id=_target.id,
                                        impact_on_asset="Detected by scanner on linked asset",
                                        created_by=None,
                                        link_source="scanner",
                                        auto_linked=True,
                                    ))

                        # Fan out enrichment for any vuln that has a CVE-ID.
                        # Wrapped in try/except so a broker/redis issue can
                        # never poison the sync — the daily refresh task
                        # will catch anything that slips through here.
                        if tenant_slug_for_enrich and db_vuln.cve_id:
                            try:
                                from ...tasks.vulnerabilities import enrich_vuln as _enrich_vuln_task
                                _enrich_vuln_task.delay(
                                    tenant_slug=tenant_slug_for_enrich,
                                    vuln_id=db_vuln.id,
                                )
                            except Exception:
                                logger.warning(
                                    "Could not dispatch enrichment for vuln %s",
                                    db_vuln.id,
                                    exc_info=False,
                                )
                            # Phase 6 — also dispatch patch-intel (MSRC) sync.
                            # Same best-effort discipline: failures here are
                            # picked up by the daily patch-intel refresh.
                            try:
                                from ...tasks.patch_intel import sync_msrc_vuln as _sync_msrc_task
                                _sync_msrc_task.delay(
                                    tenant_slug=tenant_slug_for_enrich,
                                    vuln_id=db_vuln.id,
                                )
                            except Exception:
                                logger.warning(
                                    "Could not dispatch patch-intel for vuln %s",
                                    db_vuln.id,
                                    exc_info=False,
                                )

                        if is_nessus:
                            sol_detail = merged
                        else:
                            sol_detail = detail
                        SyncService._sync_solutions_for_vuln(
                            db, adapter, sol_detail, db_vuln, tenant_id, stats
                        )

                except Exception as e:
                    logger.error(f"Error syncing vuln instance: {e}")
                    # One unprocessed instance means this host's "seen" set is
                    # incomplete — closure for the whole host is off this sync
                    # (it self-heals next sync). Presence updates above stand.
                    host_ctx["degraded"] = True
                    stats["errors_count"] += 1

        source = "nessus" if is_nessus else "nexpose"
        SyncService._apply_scanner_closures(
            db, adapter, connection, tenant_id, stats, host_contexts, source=source,
        )
        # Catch-all auto-link. The inline linking above only attaches a finding
        # when its host resolved to an asset in THIS same pass; anything that
        # missed inline resolution sits unlinked. Running the full host-identity
        # / apex matcher here means "Sync Now" in the UI (and the scheduled sync)
        # links everything by itself — no manual terminal backfill, ever. Same
        # per-connection toggle, idempotent, and best-effort: a linker hiccup
        # must never fail the sync.
        if link_assets:
            try:
                from grc.services.finding_asset_linker import backfill_host_links
                link_report = backfill_host_links(db, tenant_id, commit=False)
                stats["auto_linked_total"] = link_report.get("newly_linked", 0)
                logger.info("post-sync auto-link (tenant=%s): %s", tenant_id, link_report)
            except Exception:
                logger.exception("post-sync auto-link failed (non-fatal)")
        db.flush()

    @staticmethod
    def _sync_solutions_for_vuln(
        db: Session,
        adapter: BaseAdapter,
        vuln_detail: Dict[str, Any],
        db_vuln,
        tenant_id: int,
        stats: Dict[str, Any],
    ):
        ext_vuln_id = str(vuln_detail.get("id", "") or vuln_detail.get("plugin_id", ""))
        if not ext_vuln_id:
            return

        nessus_scan_id = vuln_detail.get("_scan_id")
        nessus_host_id = vuln_detail.get("_host_id")
        is_nessus_source = vuln_detail.get("_source") == "workbench" or nessus_scan_id is not None

        if is_nessus_source and nessus_scan_id and nessus_host_id:
            lookup_id = f"{nessus_scan_id}:{nessus_host_id}:{ext_vuln_id}"
        elif is_nessus_source:
            info = vuln_detail.get("info") or vuln_detail.get("attributes") or {}
            plugin_attrs = {}
            if isinstance(info, dict):
                plugin_attrs = info.get("plugindescription", {}).get("pluginattributes", {})
            solution_text = plugin_attrs.get("solution") or info.get("solution", "")
            see_also = plugin_attrs.get("see_also") or info.get("see_also", "")
            if solution_text or see_also:
                raw_solutions = [{
                    "id": f"nessus-sol-{ext_vuln_id}",
                    "summary": solution_text,
                    "steps": solution_text,
                    "type": "remediation",
                    "see_also": see_also,
                }]
                transformer = get_transformer(getattr(db_vuln, 'source', None) or "nessus")
                for raw_sol in raw_solutions:
                    try:
                        transformed = transformer.transform_solution(raw_sol, db_vuln.id, tenant_id)
                        existing = db.query(VulnerabilitySolution).filter(
                            VulnerabilitySolution.tenant_id == tenant_id,
                            VulnerabilitySolution.vulnerability_id == db_vuln.id,
                            VulnerabilitySolution.external_solution_id == transformed["external_solution_id"],
                        ).first()
                        if not existing:
                            db.add(VulnerabilitySolution(**transformed))
                            stats["solutions_new"] = stats.get("solutions_new", 0) + 1
                    except Exception as e:
                        logger.warning(f"Error syncing Nessus workbench solution: {e}")
                return
            lookup_id = ext_vuln_id
        else:
            lookup_id = ext_vuln_id

        try:
            raw_solutions = adapter.get_solutions(lookup_id)
        except Exception:
            return

        transformer = get_transformer(getattr(db_vuln, 'source', None) or "nexpose")
        for raw_sol in raw_solutions:
            try:
                transformed = transformer.transform_solution(raw_sol, db_vuln.id, tenant_id)
                existing = db.query(VulnerabilitySolution).filter(
                    VulnerabilitySolution.tenant_id == tenant_id,
                    VulnerabilitySolution.vulnerability_id == db_vuln.id,
                    VulnerabilitySolution.external_solution_id == transformed["external_solution_id"],
                ).first()

                if not existing:
                    db.add(VulnerabilitySolution(**transformed))
                    stats["solutions_synced"] = stats.get("solutions_synced", 0) + 1
                else:
                    for k, v in transformed.items():
                        if k not in ("tenant_id", "vulnerability_id", "external_solution_id") and v is not None:
                            setattr(existing, k, v)
                    existing.updated_at = datetime.utcnow()
            except Exception as e:
                logger.error(f"Error syncing solution for vuln {db_vuln.vuln_id}: {e}")

    # Statuses the scanner may never close on its own: decision states (a
    # human accepted the risk / called it a false positive / the asset was
    # decommissioned) and already-terminal states. Everything else — open,
    # in_progress, and the human "we fixed it" claims (remediated/resolved) —
    # is closable by verified re-scan evidence; closing a "remediated" row is
    # precisely the verified-remediation loop this feature exists for.
    _SCANNER_CLOSE_PROTECTED = (
        "accepted", "false_positive", "auto_closed_decommissioned",
        "auto_closed_fixed", "verified", "closed",
    )

    @staticmethod
    def _apply_scanner_closures(
        db: Session,
        adapter: BaseAdapter,
        connection: IntegrationConnection,
        tenant_id: int,
        stats: Dict[str, Any],
        host_contexts: List[Dict[str, Any]],
        source: Optional[str] = None,
    ):
        """Inbound half of the closure loop: auto-close findings a successful
        re-scan no longer reports.

        Safety contract (each condition is load-bearing):
          * evidence comes ONLY from scan runs with status "completed" that
            explicitly list the host (`get_scan_coverage`) — partial/failed
            runs and hosts that merely aged out of the scanner close nothing;
          * the confirming run must have ended AFTER the finding's last_seen —
            re-reading the same old scan can never close anything (idempotent);
          * preferentially the confirming run is the SAME scan that last
            reported the finding (same policy → absence is meaningful); rows
            without attribution (pre-feature legacy) fall back to any covering
            completed run, with the weaker basis recorded in the evidence;
          * hosts whose pull failed or was degraded this sync are skipped;
          * decision states are never overridden (`_SCANNER_CLOSE_PROTECTED`,
            active exceptions).
        """
        if not host_contexts:
            return
        try:
            coverage = adapter.get_scan_coverage()
        except Exception:
            logger.exception("get_scan_coverage failed — skipping auto-close for connection %s", connection.id)
            return
        if not coverage:
            logger.info("No completed-scan coverage available for connection %s — auto-close skipped", connection.id)
            return

        # Distinguish "originating scan was deleted" (fallback allowed) from
        # "originating scan exists but has no new completed run" (absence
        # unproven — it may be mid-run or simply not re-run yet; leave open).
        try:
            existing_scan_ids = {str(s.get("id")) for s in adapter.get_scans() if s.get("id")}
        except Exception:
            existing_scan_ids = {str(c.get("scan_id")) for c in coverage}

        def _to_dt(epoch) -> Optional[datetime]:
            try:
                return datetime.utcfromtimestamp(int(epoch)) if epoch else None
            except (ValueError, TypeError, OSError):
                return None

        cov_entries = []
        for entry in coverage:
            ended_dt = _to_dt(entry.get("ended_at"))
            if ended_dt is None:
                continue
            cov_entries.append({
                "scan_id": str(entry.get("scan_id")),
                "scan_name": entry.get("scan_name", ""),
                "ended_at": ended_dt,
                "host_variants": SyncService._host_variants(*entry.get("hosts", [])),
            })

        now = datetime.utcnow()
        closed_summaries: List[Dict[str, Any]] = []

        for ctx in host_contexts:
            if ctx.get("fetch_failed") or ctx.get("degraded"):
                logger.info("Auto-close skipped for host %s (pull incomplete this sync)", ctx.get("ext_id"))
                continue
            variants = SyncService._host_variants(ctx.get("host_name"), ctx.get("ip_address"), ctx.get("ext_id"))
            runs = [c for c in cov_entries if variants & c["host_variants"]]
            if not runs:
                continue

            q = db.query(Vulnerability).filter(
                Vulnerability.tenant_id == tenant_id,
                Vulnerability.affected_host == ctx["ext_id"],
                ~Vulnerability.status.in_(SyncService._SCANNER_CLOSE_PROTECTED),
            )
            if source == "nessus":
                # This connection's rows, plus pre-feature legacy rows (no
                # connection_id yet) that this same pipeline created — their
                # deterministic NS- id + affected_host prove provenance.
                q = q.filter(or_(
                    Vulnerability.connection_id == connection.id,
                    Vulnerability.connection_id.is_(None) & Vulnerability.vuln_id.like("NS-%"),
                ))
            else:
                q = q.filter(Vulnerability.connection_id == connection.id)

            for v in q.all():
                if v.vuln_id in ctx["seen_ids"]:
                    continue
                if getattr(v, "is_exception", False):
                    continue
                if (getattr(v, "exception_status", None) or "none") in ("requested", "approved"):
                    continue

                # Absence must be verifiable by the SCANNER-NATIVE id, not just
                # our row identity. Verified in the wild: two import pipelines
                # generated different vuln_ids for the same (host, plugin), so
                # an orphaned duplicate row looked "absent" while its plugin
                # was still being reported — closing it would stamp false
                # "verified fixed" evidence. A row with no external_vuln_id
                # can't be checked → never auto-closed; one whose plugin is
                # still reported for the host → still present, never closed.
                ext_pid = getattr(v, "external_vuln_id", None)
                if not ext_pid:
                    continue
                if str(ext_pid) in ctx["seen_plugins"]:
                    continue

                baseline = getattr(v, "last_seen", None) or v.discovered_at or v.created_at
                if baseline is None:
                    continue

                evidence = None
                basis = None
                seen_scan = getattr(v, "last_seen_scan_id", None)
                if seen_scan == "workbench":
                    # Workbench (Tenable.io) data has no per-scan attribution —
                    # never auto-close from it.
                    continue
                if seen_scan:
                    same = [r for r in runs if r["scan_id"] == str(seen_scan) and r["ended_at"] > baseline]
                    if same:
                        evidence = max(same, key=lambda r: r["ended_at"])
                        basis = "same_scan"
                    elif str(seen_scan) in existing_scan_ids:
                        continue
                    else:
                        later = [r for r in runs if r["ended_at"] > baseline]
                        if later:
                            evidence = max(later, key=lambda r: r["ended_at"])
                            basis = "host_coverage_origin_scan_deleted"
                else:
                    later = [r for r in runs if r["ended_at"] > baseline]
                    if later:
                        evidence = max(later, key=lambda r: r["ended_at"])
                        basis = "host_coverage"
                if evidence is None:
                    continue

                v.status = "auto_closed_fixed"
                v.scanner_status = "not-detected"
                v.closed_at = now
                v.closed_by = "SCANNER_VERIFIED"
                v.resolved_at = now
                v.closure_evidence = {
                    "scan_id": evidence["scan_id"],
                    "scan_name": evidence["scan_name"],
                    "scan_ended_at": evidence["ended_at"].isoformat() + "Z",
                    "host": ctx.get("host_name") or ctx.get("ip_address") or ctx["ext_id"],
                    "basis": basis,
                    "connection_id": connection.id,
                }
                stamp = (
                    f"[{now.strftime('%Y-%m-%d %H:%M UTC')}] Auto-closed: scan "
                    f"'{evidence['scan_name'] or evidence['scan_id']}' completed "
                    f"{evidence['ended_at'].strftime('%Y-%m-%d %H:%M UTC')} covering this host and "
                    f"no longer reports this finding (basis: {basis})."
                )
                v.resolution_notes = f"{v.resolution_notes}\n\n{stamp}" if v.resolution_notes else stamp
                v.updated_at = now
                stats["vulns_closed"] += 1
                closed_summaries.append({
                    "vulnerability_id": v.id,
                    "vuln_id": v.vuln_id,
                    "scan_id": evidence["scan_id"],
                    "basis": basis,
                })
                # CTEM Phase 2: a verified closure is dated remediation
                # evidence for every control this finding is linked to
                # (capped at the remediation-verified tier — it proves the
                # fix landed, not that the control works).
                try:
                    from grc.services.control_assurance import record_vuln_evidence
                    record_vuln_evidence(
                        db, v, source_type="scanner_closure", result="pass",
                        tested_at=evidence["ended_at"],
                        details={"scan_id": evidence["scan_id"],
                                 "scan_name": evidence["scan_name"],
                                 "basis": basis, "vuln_id": v.vuln_id},
                    )
                except Exception:
                    logger.exception("closure evidence write failed (non-fatal)")

        if closed_summaries:
            logger.info(
                "Scanner auto-close: %d finding(s) verified closed for connection %s",
                len(closed_summaries), connection.id,
            )
            # Persisted with the sync's final commit — never its own commit,
            # so a failed sync doesn't leave an audit row for closes that
            # rolled back.
            db.add(IntegrationAuditLog(
                tenant_id=tenant_id,
                connection_id=connection.id,
                entity_type="connection",
                entity_id=connection.id,
                action="scanner_auto_close",
                performed_by="SCANNER_VERIFIED",
                metadata_info={"closed": closed_summaries[:200], "count": len(closed_summaries)},
            ))

    @staticmethod
    def _sync_scans(
        db: Session,
        adapter: BaseAdapter,
        connection: IntegrationConnection,
        tenant_id: int,
        stats: Dict[str, Any],
    ):
        transformer = get_transformer(connection.integration_type)
        try:
            raw_scans = adapter.get_scans()
        except Exception as e:
            logger.error(f"Error fetching scans: {e}")
            stats["errors_count"] += 1
            return

        for raw_scan in raw_scans:
            try:
                transformed = transformer.transform_scan(raw_scan, connection.id, tenant_id)
                ext_scan_id = transformed["external_scan_id"]

                existing = db.query(ScanRecord).filter(
                    ScanRecord.tenant_id == tenant_id,
                    ScanRecord.connection_id == connection.id,
                    ScanRecord.external_scan_id == ext_scan_id,
                ).first()

                if not existing:
                    db.add(ScanRecord(**transformed))
                    stats["scans_synced"] = stats.get("scans_synced", 0) + 1
                else:
                    for k, v in transformed.items():
                        if k not in ("tenant_id", "connection_id", "external_scan_id") and v is not None:
                            setattr(existing, k, v)
            except Exception as e:
                logger.error(f"Error syncing scan {raw_scan.get('id')}: {e}")
                stats["errors_count"] += 1

        db.flush()

    @staticmethod
    def get_sync_history(
        db: Session,
        connection_id: int,
        tenant_id: int,
        limit: int = 20,
        offset: int = 0,
    ) -> Tuple[List[SyncHistory], int]:
        query = db.query(SyncHistory).filter(
            SyncHistory.tenant_id == tenant_id,
            SyncHistory.connection_id == connection_id,
        ).order_by(SyncHistory.started_at.desc())

        total = query.count()
        records = query.offset(offset).limit(limit).all()
        return records, total

    @staticmethod
    def _audit(
        db: Session,
        tenant_id: int,
        entity_type: str,
        entity_id: int,
        action: str,
        performed_by_user_id: Optional[int] = None,
        details: Optional[Dict] = None,
    ):
        try:
            connection_id: Optional[int] = None

            if entity_type == "connection":
                connection_id = entity_id
            elif details and isinstance(details, dict) and details.get("connection_id"):
                connection_id = int(details.get("connection_id"))
            elif entity_type == "sync":
                sync_row = db.query(SyncHistory).filter(
                    SyncHistory.id == entity_id,
                    SyncHistory.tenant_id == tenant_id,
                ).first()
                if sync_row:
                    connection_id = sync_row.connection_id
            elif entity_type == "exception_request":
                # Local import to avoid hard dependency/cycles for this optional path.
                from grc.models import OutboundExceptionRequest

                req = db.query(OutboundExceptionRequest).filter(
                    OutboundExceptionRequest.id == entity_id,
                    OutboundExceptionRequest.tenant_id == tenant_id,
                ).first()
                if req:
                    connection_id = req.connection_id

            # Audit logs must always be tied to a connection in current schema.
            if not connection_id:
                logger.warning(
                    "Skipping integration audit log due to missing connection_id "
                    "(entity_type=%s entity_id=%s action=%s)",
                    entity_type,
                    entity_id,
                    action,
                )
                return

            log = IntegrationAuditLog(
                tenant_id=tenant_id,
                connection_id=connection_id,
                entity_type=entity_type,
                entity_id=entity_id,
                action=action,
                performed_by_user_id=performed_by_user_id,
                performed_by=f"user:{performed_by_user_id}" if performed_by_user_id else "SYSTEM",
                metadata_info=details,
            )
            db.add(log)
            db.commit()
        except Exception as e:
            # Never fail core integration flows because of audit logging failures.
            db.rollback()
            logger.error(
                "Failed to write integration audit log (entity_type=%s entity_id=%s action=%s): %s",
                entity_type,
                entity_id,
                action,
                e,
            )
