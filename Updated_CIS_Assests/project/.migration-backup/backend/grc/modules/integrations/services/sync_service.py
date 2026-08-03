import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

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
        if critical > 0:
            criticality = "critical"
        elif severe > 0:
            criticality = "high"
        else:
            criticality = "medium"

        lines = [
            "Auto-synced from vulnerability scanner",
            f"Scanner source: {transformed.get('scanner_source', 'unknown')}",
            f"External asset id: {transformed.get('external_asset_id', '')}",
            f"Total vulnerabilities: {transformed.get('total_vulns', 0)}",
            f"Critical: {critical}, High: {severe}, Medium: {transformed.get('moderate_vulns', 0) or 0}",
        ]

        return {
            "name": transformed.get("name") or transformed.get("host_name") or transformed.get("ip_address") or "Scanner Asset",
            "asset_type": "infrastructure",
            "host_name": transformed.get("host_name") or None,
            "ip_address": transformed.get("ip_address") or None,
            "criticality": criticality,
            "status": "active",
            "description": "\n".join(lines),
            "vendor": transformed.get("scanner_source") or None,
            "location": transformed.get("nexpose_site") or None,
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
            "affected_host": transformed.get("affected_host"),
            "evidence": transformed.get("proof"),
            "status": transformed.get("status") or "open",
            "discovered_at": discovered_at,
            "updated_at": datetime.utcnow(),
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
            "vulns_new": 0, "vulns_updated": 0, "vulns_closed": 0,
            "solutions_synced": 0, "scans_synced": 0, "errors_count": 0,
            "error_details": [],
        }

        try:
            synced_assets = SyncService._sync_assets(db, adapter, connection, tenant_id, stats)
            SyncService._sync_vulnerabilities(db, adapter, connection, tenant_id, stats, synced_assets=synced_assets)
            SyncService._sync_scans(db, adapter, connection, tenant_id, stats)

            history.status = "completed"
            connection.last_sync_status = "success"
            connection.consecutive_failures = 0
        except Exception as e:
            logger.exception(f"Sync failed for connection {connection_id}: {e}")
            history.status = "failed"
            stats["errors_count"] += 1
            stats["error_details"].append({"phase": "general", "error": str(e)[:500]})
            connection.last_sync_status = "failed"
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

                existing = None
                host_name = mapped_asset.get("host_name")
                ip_address = mapped_asset.get("ip_address")
                name = mapped_asset.get("name")
                if host_name:
                    existing = db.query(ITAsset).filter(
                        ITAsset.tenant_id == tenant_id,
                        ITAsset.host_name == host_name,
                    ).first()
                if not existing and ip_address:
                    existing = db.query(ITAsset).filter(
                        ITAsset.tenant_id == tenant_id,
                        ITAsset.ip_address == ip_address,
                    ).first()
                if not existing and name:
                    existing = db.query(ITAsset).filter(
                        ITAsset.tenant_id == tenant_id,
                        ITAsset.name == name,
                    ).first()

                if existing:
                    changed = False
                    for key, val in mapped_asset.items():
                        if val is None:
                            continue
                        current = getattr(existing, key, None)
                        # Keep manually edited display names for scanner-fetched assets.
                        if key == "name" and current and current != val:
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
                    if changed:
                        if hasattr(existing, "updated_at"):
                            existing.updated_at = datetime.utcnow()
                        stats["assets_updated"] += 1
                    if not changed:
                        stats["assets_unchanged"] += 1
                    synced_assets.append({
                        "asset": existing,
                        "external_asset_id": ext_id,
                        "host_name": host_name or "",
                        "ip_address": ip_address or "",
                    })
                else:
                    asset = ITAsset(
                        tenant_id=tenant_id,
                        **mapped_asset,
                    )
                    db.add(asset)
                    stats["assets_new"] += 1
                    synced_assets.append({
                        "asset": asset,
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

        seen_vuln_ids = set()
        vuln_detail_cache: Dict[str, Dict] = {}

        for asset_ref in synced_assets:
            try:
                asset = asset_ref["asset"]
                external_asset_id = asset_ref.get("external_asset_id") or getattr(asset, "host_name", "") or getattr(asset, "ip_address", "") or getattr(asset, "name", "")
                if is_nessus:
                    instances = adapter.get_asset_vulnerabilities(
                        external_asset_id,
                        hostname=asset_ref.get("host_name", "") or getattr(asset, "host_name", "") or "",
                        ip_address=asset_ref.get("ip_address", "") or getattr(asset, "ip_address", "") or "",
                    )
                else:
                    instances = adapter.get_asset_vulnerabilities(external_asset_id)
                SyncService._debug_shape(f"sync_vulns.instances.asset_{asset.id}", instances)
            except Exception as e:
                logger.error(f"Error fetching vulns for asset {asset.id}: {e}")
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
                    gen_vuln_id = mapped_vuln["vuln_id"]
                    seen_vuln_ids.add(gen_vuln_id)

                    existing = db.query(Vulnerability).filter(
                        Vulnerability.tenant_id == tenant_id,
                        Vulnerability.vuln_id == gen_vuln_id,
                    ).first()

                    if existing:
                        changed = False
                        skip_fields = {"tenant_id", "vuln_id", "created_at"}
                        for key, val in mapped_vuln.items():
                            if key in skip_fields or val is None:
                                continue
                            current = getattr(existing, key, None)
                            if current != val:
                                setattr(existing, key, val)
                                changed = True
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
                    if db_vuln:
                        existing_link = db.query(VulnerabilityAssetLink).filter(
                            VulnerabilityAssetLink.vulnerability_id == db_vuln.id,
                            VulnerabilityAssetLink.asset_id == asset.id,
                        ).first()
                        if not existing_link:
                            db.add(VulnerabilityAssetLink(
                                vulnerability_id=db_vuln.id,
                                asset_id=asset.id,
                                impact_on_asset="Detected by scanner on linked asset",
                                created_by=None,
                            ))

                        if is_nessus:
                            sol_detail = merged
                        else:
                            sol_detail = detail
                        SyncService._sync_solutions_for_vuln(
                            db, adapter, sol_detail, db_vuln, tenant_id, stats
                        )

                except Exception as e:
                    logger.error(f"Error syncing vuln instance: {e}")
                    stats["errors_count"] += 1

        source = "nessus" if is_nessus else "nexpose"
        SyncService._close_resolved_vulns(db, connection.id, tenant_id, seen_vuln_ids, stats, source=source)
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

    @staticmethod
    def _close_resolved_vulns(
        db: Session,
        connection_id: int,
        tenant_id: int,
        seen_vuln_ids: set,
        stats: Dict[str, Any],
        source: Optional[str] = None,
    ):
        if not hasattr(Vulnerability, "connection_id"):
            logger.info("Skipping scanner auto-close because Vulnerability.connection_id is not available in current schema")
            return
        open_statuses = ("open", "under_review", "in_remediation")
        query = db.query(Vulnerability).filter(
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.connection_id == connection_id,
            Vulnerability.status.in_(open_statuses),
        )
        if source:
            query = query.filter(Vulnerability.source == source)
        open_vulns = query.all()

        for vuln in open_vulns:
            if vuln.vuln_id not in seen_vuln_ids:
                vuln.status = "closed_scanner"
                vuln.scanner_status = "not-vulnerable"
                vuln.closed_at = datetime.utcnow()
                vuln.closed_by = "SCANNER_AUTO_CLOSE"
                vuln.updated_at = datetime.utcnow()
                stats["vulns_closed"] += 1

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
