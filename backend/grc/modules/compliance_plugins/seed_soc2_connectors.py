"""Built-in SOC 2 evidence-collector plugins (v1).

Additive catalog: benchmark SOC2_CONNECTORS_v1. One plugin per SaaS provider
(github/okta/slack/…), runner_type="live_api", check_definition={"provider": …}.
Generated from live_api_catalog.PROVIDER_API — no hand-maintained list. Idempotent
UPSERT with tenant_id=NULL / is_builtin=True — same pattern as SOC2_QUANTITATIVE_v1.

A connector touches several SOC 2 criteria, so it maps to ALL of its control
codes via PluginControlMapping (rule_id holds the primary code for display).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from grc.models import CompliancePlugin, FrameworkControl, PluginControlMapping

from .runners.live_api_catalog import PROVIDER_API, all_control_codes

logger = logging.getLogger(__name__)

BENCHMARK = "SOC2_CONNECTORS_v1"
_SOURCE_URL = "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria"


def _spec(provider: str, s: Dict[str, Any]) -> Dict[str, Any]:
    codes = all_control_codes(provider)
    return {
        "plugin_key": f"{BENCHMARK}__{provider}",
        "benchmark": BENCHMARK,
        "rule_id": s["controls"][0],  # primary code (display / 1:1-compat); full set mapped separately
        "title": f"SOC 2 evidence collector — {s['label']}",
        "description": f"Read-only API evidence from {s['label']} mapped to SOC 2 {', '.join(codes)}.",
        "rationale": f"Automated {s['label']} access/configuration evidence supports the mapped SOC 2 criteria.",
        "remediation": f"Configure a read-only {s['label']} API token under Administration → Evidence Collectors, then re-run.",
        "severity": "medium",
        "runner_type": "live_api",
        "check_definition": {"provider": provider},
        "source_url": _SOURCE_URL,
    }


CONNECTOR_LIBRARY: List[Dict[str, Any]] = [
    _spec(p, s) for p, s in sorted(PROVIDER_API.items(), key=lambda kv: (kv[1]["category"], kv[0]))
]


def seed_soc2_connector_plugins(db: Session) -> int:
    """Idempotently upsert SOC2_CONNECTORS_v1 built-in plugins into a tenant DB."""
    touched = 0
    for spec in CONNECTOR_LIBRARY:
        existing = (
            db.query(CompliancePlugin)
            .filter(
                CompliancePlugin.tenant_id.is_(None),
                CompliancePlugin.plugin_key == spec["plugin_key"],
            )
            .first()
        )
        if existing:
            for k, v in spec.items():
                setattr(existing, k, v)
            existing.is_builtin = True
            db.add(existing)
        else:
            db.add(CompliancePlugin(tenant_id=None, is_builtin=True, **spec))
        touched += 1
    db.commit()
    logger.info("seed_soc2_connector_plugins: upserted %d plugins", touched)
    return touched


def ensure_soc2_connector_mappings(db: Session, tenant_id: int) -> int:
    """PluginControlMapping for every control code each connector can evidence.

    Maps to FrameworkControl by code; skips silently where the tenant has no
    matching SOC 2 framework control (same tolerance as the quantitative seed)."""
    plugins = (
        db.query(CompliancePlugin)
        .filter(
            CompliancePlugin.benchmark == BENCHMARK,
            CompliancePlugin.tenant_id.is_(None),
        )
        .all()
    )
    if not plugins:
        return 0

    created = 0
    for plugin in plugins:
        provider = (plugin.check_definition or {}).get("provider")
        if not provider:
            continue
        for code in all_control_codes(provider):
            fc = db.query(FrameworkControl).filter(FrameworkControl.code == code).first()
            if fc is None:
                continue
            exists = (
                db.query(PluginControlMapping)
                .filter(
                    PluginControlMapping.tenant_id == tenant_id,
                    PluginControlMapping.plugin_id == plugin.id,
                    PluginControlMapping.framework_control_id == fc.id,
                )
                .first()
            )
            if exists:
                continue
            db.add(PluginControlMapping(
                tenant_id=tenant_id,
                plugin_id=plugin.id,
                framework_control_id=fc.id,
                weight=1.0,
            ))
            created += 1
    if created:
        db.commit()
    return created
