"""Per-tenant TPRA defaults: the ten risk domains and the default tiering config.

Idempotent and side-effect-light — callable lazily from the API or explicitly
from the seed script. The engines do NOT depend on these rows existing (they
fall back to DEFAULT_TIERING_CONFIG); this just materializes editable rows so
admins can tune weights/thresholds and rename domains in the UI.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ....models import TPRARiskDomain, TPRATieringConfig
from ....models._41_tpra_lifecycle_models import TPRA_RISK_DOMAINS
from .stages import DEFAULT_CADENCE_DAYS

# Canonical, configurable inputs to the inherent-risk tiering engine. Factors are
# each scored 0..4; the weighted sum is normalized to 0..100 and bucketed by the
# thresholds (descending). These are DEFAULTS — a TPRATieringConfig row overrides.
DEFAULT_TIERING_CONFIG = {
    "weights": {
        "data_sensitivity": 0.30,
        "business_criticality": 0.25,
        "system_access": 0.20,
        "regulatory_scope": 0.15,
        "fourth_party": 0.10,
    },
    "thresholds": {  # on a 0..100 scale, evaluated high→low
        "critical": 75.0,
        "high": 50.0,
        "medium": 25.0,
    },
    "cadence_days": dict(DEFAULT_CADENCE_DAYS),
}


def ensure_tpra_tenant_defaults(db: Session, tenant_id: int) -> dict:
    """Seed the ten risk domains and a default tiering-config row for a tenant.
    Idempotent: existing domains/config are left untouched. Returns a small
    summary so callers can log what happened."""
    created_domains = 0
    existing_keys = {
        k for (k,) in db.query(TPRARiskDomain.domain_key)
        .filter(TPRARiskDomain.tenant_id == tenant_id).all()
    }
    for i, d in enumerate(TPRA_RISK_DOMAINS):
        if d["key"] in existing_keys:
            continue
        db.add(TPRARiskDomain(
            tenant_id=tenant_id,
            domain_key=d["key"],
            label=d["label"],
            order=i + 1,
            is_active=True,
        ))
        created_domains += 1

    config_created = False
    has_config = (
        db.query(TPRATieringConfig.id)
        .filter(
            TPRATieringConfig.tenant_id == tenant_id,
            TPRATieringConfig.config_key == "default",
        )
        .first()
    )
    if not has_config:
        db.add(TPRATieringConfig(
            tenant_id=tenant_id,
            config_key="default",
            weights=DEFAULT_TIERING_CONFIG["weights"],
            thresholds=DEFAULT_TIERING_CONFIG["thresholds"],
            cadence_days=DEFAULT_TIERING_CONFIG["cadence_days"],
            is_active=True,
        ))
        config_created = True

    if created_domains or config_created:
        db.commit()
    return {"domains_created": created_domains, "config_created": config_created}


def get_tiering_config(db: Session, tenant_id: int) -> dict:
    """Return the tenant's active tiering config, falling back to DEFAULT."""
    row: Optional[TPRATieringConfig] = (
        db.query(TPRATieringConfig)
        .filter(
            TPRATieringConfig.tenant_id == tenant_id,
            TPRATieringConfig.config_key == "default",
            TPRATieringConfig.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not row:
        return dict(DEFAULT_TIERING_CONFIG)
    return {
        "weights": row.weights or DEFAULT_TIERING_CONFIG["weights"],
        "thresholds": row.thresholds or DEFAULT_TIERING_CONFIG["thresholds"],
        "cadence_days": row.cadence_days or DEFAULT_TIERING_CONFIG["cadence_days"],
    }
