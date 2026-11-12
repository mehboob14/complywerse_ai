"""Basel loss-event taxonomy (Basel Framework OPE25): level-1 event types and business lines.

Mirrored in grc-frontend/src/app/(dashboard)/erm/incidents/lossEvents.ts; its node test reads this file to keep them equal.
"""
from typing import Dict, Optional

EVENT_TYPES: Dict[str, str] = {
    "internal_fraud": "Internal fraud",
    "external_fraud": "External fraud",
    "employment_practices": "Employment practices and workplace safety",
    "clients_products": "Clients, products and business practices",
    "physical_assets": "Damage to physical assets",
    "business_disruption": "Business disruption and system failures",
    "execution_delivery": "Execution, delivery and process management",
}

BUSINESS_LINES: Dict[str, str] = {
    "corporate_finance": "Corporate finance",
    "trading_sales": "Trading and sales",
    "retail_banking": "Retail banking",
    "commercial_banking": "Commercial banking",
    "payment_settlement": "Payment and settlement",
    "agency_services": "Agency services",
    "asset_management": "Asset management",
    "retail_brokerage": "Retail brokerage",
}


def taxonomy_key(raw: Optional[str], table: Dict[str, str], what: str) -> Optional[str]:
    """The key for a key or a label (any case); None when blank. Raises ValueError naming `what` for anything else."""
    text = (raw or "").strip()
    if not text:
        return None
    for key, label in table.items():
        if text.lower() in (key, label.lower()):
            return key
    raise ValueError(f"unknown {what} '{text}'")


def taxonomy() -> dict:
    as_list = lambda table: [{"key": k, "label": v} for k, v in table.items()]  # noqa: E731
    return {"event_types": as_list(EVENT_TYPES), "business_lines": as_list(BUSINESS_LINES)}
