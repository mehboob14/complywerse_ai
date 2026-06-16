import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, and_, case
from sqlalchemy.orm import Session

from grc.models import (
    IntegrationConnection,
    ITAsset,
    ScanRecord,
    SyncHistory,
    Vulnerability,
    VulnerabilityControlLink,
    OutboundExceptionRequest,
)

logger = logging.getLogger(__name__)


SCANNER_SOURCES = ("nexpose", "nessus")


class AnalyticsService:

    @staticmethod
    def get_overview(db: Session, tenant_id: int, connection_id: Optional[int] = None) -> Dict[str, Any]:
        base_filter = [
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
        ]
        if connection_id:
            base_filter.append(Vulnerability.connection_id == connection_id)

        total = db.query(func.count(Vulnerability.id)).filter(*base_filter).scalar() or 0

        severity_counts = dict(
            db.query(
                Vulnerability.compliverse_severity,
                func.count(Vulnerability.id),
            ).filter(*base_filter).group_by(Vulnerability.compliverse_severity).all()
        )

        status_counts = dict(
            db.query(
                Vulnerability.status,
                func.count(Vulnerability.id),
            ).filter(*base_filter).group_by(Vulnerability.status).all()
        )

        open_statuses = ("open", "under_review", "in_remediation")
        open_count = sum(status_counts.get(s, 0) for s in open_statuses)
        closed_count = sum(v for k, v in status_counts.items() if k not in open_statuses)

        now = datetime.utcnow()
        overdue = db.query(func.count(Vulnerability.id)).filter(
            *base_filter,
            Vulnerability.status.in_(open_statuses),
            Vulnerability.due_date.isnot(None),
            Vulnerability.due_date < now,
        ).scalar() or 0

        asset_filter = [ITAsset.tenant_id == tenant_id, ITAsset.scanner_source.in_(SCANNER_SOURCES)]
        if connection_id:
            asset_filter.append(ITAsset.scanner_connection_id == connection_id)
        total_assets = db.query(func.count(ITAsset.id)).filter(*asset_filter).scalar() or 0

        return {
            "total_vulnerabilities": total,
            "open_vulnerabilities": open_count,
            "closed_vulnerabilities": closed_count,
            "overdue_vulnerabilities": overdue,
            "total_assets": total_assets,
            "severity_distribution": {
                "critical": severity_counts.get("critical", 0),
                "high": severity_counts.get("high", 0),
                "medium": severity_counts.get("medium", 0),
                "low": severity_counts.get("low", 0),
                "info": severity_counts.get("info", 0),
            },
            "status_distribution": status_counts,
        }

    @staticmethod
    def get_trends(
        db: Session,
        tenant_id: int,
        days: int = 30,
        connection_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        now = datetime.utcnow()
        start = now - timedelta(days=days)

        base_filter = [
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
        ]
        if connection_id:
            base_filter.append(Vulnerability.connection_id == connection_id)

        new_vulns = db.query(
            func.date(Vulnerability.created_at),
            func.count(Vulnerability.id),
        ).filter(
            *base_filter,
            Vulnerability.created_at >= start,
        ).group_by(func.date(Vulnerability.created_at)).all()

        closed_vulns = db.query(
            func.date(Vulnerability.closed_at),
            func.count(Vulnerability.id),
        ).filter(
            *base_filter,
            Vulnerability.closed_at.isnot(None),
            Vulnerability.closed_at >= start,
        ).group_by(func.date(Vulnerability.closed_at)).all()

        new_by_date = {str(d): c for d, c in new_vulns}
        closed_by_date = {str(d): c for d, c in closed_vulns}

        trend_data = []
        for i in range(days):
            date = (start + timedelta(days=i)).strftime("%Y-%m-%d")
            trend_data.append({
                "date": date,
                "new": new_by_date.get(date, 0),
                "closed": closed_by_date.get(date, 0),
            })

        return {"period_days": days, "trends": trend_data}

    @staticmethod
    def get_mttr(
        db: Session,
        tenant_id: int,
        connection_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        base_filter = [
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
            Vulnerability.time_to_remediate_hours.isnot(None),
        ]
        if connection_id:
            base_filter.append(Vulnerability.connection_id == connection_id)

        result = db.query(
            Vulnerability.compliverse_severity,
            func.avg(Vulnerability.time_to_remediate_hours),
            func.min(Vulnerability.time_to_remediate_hours),
            func.max(Vulnerability.time_to_remediate_hours),
            func.count(Vulnerability.id),
        ).filter(*base_filter).group_by(Vulnerability.compliverse_severity).all()

        mttr_data = {}
        overall_sum = 0
        overall_count = 0
        for severity, avg_h, min_h, max_h, count in result:
            mttr_data[severity or "unknown"] = {
                "avg_hours": round(float(avg_h), 1) if avg_h else 0,
                "avg_days": round(float(avg_h) / 24, 1) if avg_h else 0,
                "min_hours": int(min_h) if min_h else 0,
                "max_hours": int(max_h) if max_h else 0,
                "count": count,
            }
            overall_sum += (float(avg_h) or 0) * count
            overall_count += count

        overall_avg = round(overall_sum / overall_count, 1) if overall_count > 0 else 0

        return {
            "overall_mttr_hours": overall_avg,
            "overall_mttr_days": round(overall_avg / 24, 1) if overall_avg else 0,
            "by_severity": mttr_data,
        }

    @staticmethod
    def get_sla_compliance(
        db: Session,
        tenant_id: int,
        connection_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        now = datetime.utcnow()
        base_filter = [
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
            Vulnerability.due_date.isnot(None),
        ]
        if connection_id:
            base_filter.append(Vulnerability.connection_id == connection_id)

        open_statuses = ("open", "under_review", "in_remediation")

        total_with_sla = db.query(func.count(Vulnerability.id)).filter(*base_filter).scalar() or 0
        on_time_closed = db.query(func.count(Vulnerability.id)).filter(
            *base_filter,
            Vulnerability.closed_at.isnot(None),
            Vulnerability.closed_at <= Vulnerability.due_date,
        ).scalar() or 0
        late_closed = db.query(func.count(Vulnerability.id)).filter(
            *base_filter,
            Vulnerability.closed_at.isnot(None),
            Vulnerability.closed_at > Vulnerability.due_date,
        ).scalar() or 0
        currently_overdue = db.query(func.count(Vulnerability.id)).filter(
            *base_filter,
            Vulnerability.status.in_(open_statuses),
            Vulnerability.due_date < now,
        ).scalar() or 0
        within_sla = db.query(func.count(Vulnerability.id)).filter(
            *base_filter,
            Vulnerability.status.in_(open_statuses),
            Vulnerability.due_date >= now,
        ).scalar() or 0

        compliance_rate = 0
        closed_total = on_time_closed + late_closed
        if closed_total > 0:
            compliance_rate = round((on_time_closed / closed_total) * 100, 1)

        return {
            "total_with_sla": total_with_sla,
            "on_time_closed": on_time_closed,
            "late_closed": late_closed,
            "currently_overdue": currently_overdue,
            "within_sla": within_sla,
            "compliance_rate": compliance_rate,
        }

    @staticmethod
    def get_top_affected_assets(
        db: Session,
        tenant_id: int,
        limit: int = 10,
        connection_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        asset_filter = [ITAsset.tenant_id == tenant_id, ITAsset.scanner_source.in_(SCANNER_SOURCES)]
        if connection_id:
            asset_filter.append(ITAsset.scanner_connection_id == connection_id)

        assets = db.query(ITAsset).filter(
            *asset_filter,
        ).order_by(ITAsset.total_vulns.desc().nullslast()).limit(limit).all()

        return [
            {
                "id": a.id,
                "name": a.name,
                "ip_address": a.ip_address,
                "host_name": a.host_name,
                "criticality": a.criticality,
                "total_vulns": a.total_vulns or 0,
                "critical_vulns": a.critical_vulns or 0,
                "severe_vulns": a.severe_vulns or 0,
                "external_risk_score": a.external_risk_score,
            }
            for a in assets
        ]

    @staticmethod
    def get_scanner_coverage(
        db: Session,
        tenant_id: int,
        connection_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        asset_filter = [ITAsset.tenant_id == tenant_id, ITAsset.scanner_source.in_(SCANNER_SOURCES)]
        if connection_id:
            asset_filter.append(ITAsset.scanner_connection_id == connection_id)

        total_scanner_assets = db.query(func.count(ITAsset.id)).filter(*asset_filter).scalar() or 0
        total_all_assets = db.query(func.count(ITAsset.id)).filter(
            ITAsset.tenant_id == tenant_id,
        ).scalar() or 0

        assessed = db.query(func.count(ITAsset.id)).filter(
            *asset_filter,
            ITAsset.is_assessed == True,
        ).scalar() or 0

        now = datetime.utcnow()
        stale_threshold = now - timedelta(days=30)
        stale = db.query(func.count(ITAsset.id)).filter(
            *asset_filter,
            ITAsset.last_scan_date.isnot(None),
            ITAsset.last_scan_date < stale_threshold,
        ).scalar() or 0

        coverage_pct = round((total_scanner_assets / total_all_assets * 100), 1) if total_all_assets > 0 else 0

        return {
            "total_assets": total_all_assets,
            "scanner_assets": total_scanner_assets,
            "assessed_assets": assessed,
            "stale_assets": stale,
            "coverage_percentage": coverage_pct,
        }

    @staticmethod
    def get_connection_stats(
        db: Session,
        tenant_id: int,
    ) -> List[Dict[str, Any]]:
        connections = db.query(IntegrationConnection).filter(
            IntegrationConnection.tenant_id == tenant_id,
        ).all()

        stats = []
        for conn in connections:
            vuln_count = db.query(func.count(Vulnerability.id)).filter(
                Vulnerability.tenant_id == tenant_id,
                Vulnerability.connection_id == conn.id,
                Vulnerability.source.in_(SCANNER_SOURCES),
            ).scalar() or 0

            asset_count = db.query(func.count(ITAsset.id)).filter(
                ITAsset.tenant_id == tenant_id,
                ITAsset.scanner_connection_id == conn.id,
            ).scalar() or 0

            last_sync = db.query(SyncHistory).filter(
                SyncHistory.connection_id == conn.id,
            ).order_by(SyncHistory.started_at.desc()).first()

            stats.append({
                "connection_id": conn.id,
                "connection_name": conn.connection_name,
                "is_active": conn.is_active,
                "status": conn.status,
                "total_vulns": vuln_count,
                "total_assets": asset_count,
                "last_sync_at": conn.last_sync_at.isoformat() if conn.last_sync_at else None,
                "last_sync_status": conn.last_sync_status,
                "last_sync_duration_ms": last_sync.duration_ms if last_sync else None,
                "consecutive_failures": conn.consecutive_failures,
            })

        return stats

    @staticmethod
    def get_exception_analytics(
        db: Session,
        tenant_id: int,
        connection_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        base_filter = [OutboundExceptionRequest.tenant_id == tenant_id]
        if connection_id:
            base_filter.append(OutboundExceptionRequest.connection_id == connection_id)

        total = db.query(func.count(OutboundExceptionRequest.id)).filter(*base_filter).scalar() or 0

        status_counts = dict(
            db.query(
                OutboundExceptionRequest.status,
                func.count(OutboundExceptionRequest.id),
            ).filter(*base_filter).group_by(OutboundExceptionRequest.status).all()
        )

        type_counts = dict(
            db.query(
                OutboundExceptionRequest.exception_type,
                func.count(OutboundExceptionRequest.id),
            ).filter(*base_filter).group_by(OutboundExceptionRequest.exception_type).all()
        )

        push_counts = dict(
            db.query(
                OutboundExceptionRequest.push_status,
                func.count(OutboundExceptionRequest.id),
            ).filter(
                *base_filter,
                OutboundExceptionRequest.push_status.isnot(None),
            ).group_by(OutboundExceptionRequest.push_status).all()
        )

        return {
            "total": total,
            "by_status": status_counts,
            "by_type": type_counts,
            "by_push_status": push_counts,
        }

    @staticmethod
    def get_scoring_distribution(
        db: Session,
        tenant_id: int,
        connection_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        base_filter = [
            Vulnerability.tenant_id == tenant_id,
            Vulnerability.source.in_(SCANNER_SOURCES),
            Vulnerability.compliverse_risk_score.isnot(None),
        ]
        if connection_id:
            base_filter.append(Vulnerability.connection_id == connection_id)

        avg_score = db.query(func.avg(Vulnerability.compliverse_risk_score)).filter(*base_filter).scalar()
        max_score = db.query(func.max(Vulnerability.compliverse_risk_score)).filter(*base_filter).scalar()
        min_score = db.query(func.min(Vulnerability.compliverse_risk_score)).filter(*base_filter).scalar()

        severity_dist = dict(
            db.query(
                Vulnerability.compliverse_severity,
                func.count(Vulnerability.id),
            ).filter(*base_filter).group_by(Vulnerability.compliverse_severity).all()
        )

        return {
            "avg_score": round(float(avg_score), 2) if avg_score else 0,
            "max_score": round(float(max_score), 2) if max_score else 0,
            "min_score": round(float(min_score), 2) if min_score else 0,
            "severity_distribution": severity_dist,
        }
