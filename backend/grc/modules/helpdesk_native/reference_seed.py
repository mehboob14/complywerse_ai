"""Help Desk reference configuration, seeded per tenant on every boot.

The JSON in grc/seed_data/helpdesk_reference/ is the full standard configuration
(ticket types, templates, process categories, service catalogue, SLAs, CMDB types,
settings). One file per table, rows keyed by natural key, foreign keys written as
the parent's natural key. This module adds whatever a tenant is missing:

  * add-only — a row whose natural key exists is left exactly as the tenant has it;
  * idempotent — a second run adds nothing;
  * FKs are remapped to this tenant's ids through the parents' natural keys.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, inspect
from sqlalchemy.orm import Session

from ...models import Base

logger = logging.getLogger(__name__)

SEED_DIR = Path(__file__).resolve().parents[2] / "seed_data" / "helpdesk_reference"

_PRI, _STATUS, _SLA = "grc_hd_ticket_priority", "grc_hd_ticket_status", "grc_hd_service_level_agreement"

# (table, natural key, {fk field: parent table}) in insert order; every parent comes first.
# A table with no tenant_id is scoped through its parent (the SLA). "parent" is the same table.
SPEC: List[Tuple[str, Tuple[str, ...], Dict[str, str]]] = [
    (_PRI, ("name",), {}),
    (_STATUS, ("label_agent",), {}),
    ("grc_hd_agent_status", ("agent_status",), {}),
    ("grc_hd_department", ("name",), {}),
    ("grc_hd_ticket_type", ("name",), {"priority": _PRI, "department": "grc_hd_department"}),
    ("grc_hd_ticket_template", ("template_name",), {"department": "grc_hd_department"}),
    ("grc_hd_ticket_feedback_option", ("label",), {}),
    ("grc_hd_service_category", ("code",), {"parent": "grc_hd_service_category"}),
    ("grc_hd_ci_type", ("code",), {"parent": "grc_hd_ci_type"}),
    ("grc_hd_ci_relationship_type", ("code",), {}),
    ("grc_hd_change_type", ("code",), {}),
    ("grc_hd_change_risk_matrix", ("impact", "likelihood"), {}),
    ("grc_hd_change_category", ("key",), {"parent": "grc_hd_change_category"}),
    ("grc_hd_incident_category", ("key",), {"parent": "grc_hd_incident_category"}),
    ("grc_hd_problem_category", ("key",), {"parent": "grc_hd_problem_category"}),
    ("grc_hd_request_item", ("code",), {"category": "grc_hd_service_category", "ci_type": "grc_hd_ci_type",
                                        "template": "grc_hd_ticket_template"}),
    (_SLA, ("service_level",), {"default_priority": _PRI, "default_ticket_status": _STATUS,
                                "ticket_reopen_status": _STATUS}),
    ("grc_hd_service_level_priority", ("sla", "priority"), {"sla": _SLA, "priority": _PRI}),
    ("grc_hd_service_day", ("sla", "idx"), {"sla": _SLA}),
    ("grc_hd_sla_target", ("process", "priority_code", "service_window"), {}),
    ("grc_hd_priority_matrix", ("impact", "urgency"), {"priority": _PRI}),
    ("grc_hd_settings", (), {"default_priority": _PRI, "default_agent_status": "grc_hd_agent_status",
                             "default_ticket_type": "grc_hd_ticket_type", "default_ticket_status": _STATUS,
                             "ticket_reopen_status": _STATUS, "update_status_to": _STATUS,
                             "auto_close_status": _STATUS, "send_email_feedback_on_status": _STATUS}),
]
_KEY_OF = {t: k for t, k, _ in SPEC}


def load_rows(table: str) -> List[Dict[str, Any]]:
    return json.loads((SEED_DIR / f"{table}.json").read_text(encoding="utf-8"))


def _col(field: str, fks: Dict[str, str]) -> str:
    return f"{field}_id" if field in fks else field


class _Ids:
    """Natural key → id for one tenant's rows of a parent table, read once per table."""

    def __init__(self, db: Session, tid: int):
        self.db, self.tid, self.cache = db, tid, {}

    def get(self, table: str, nk: Any) -> Optional[int]:
        if nk is None:
            return None
        if table not in self.cache:
            t = Base.metadata.tables[table]
            key = _KEY_OF[table]
            q = self.db.query(t.c.id, *[t.c[k] for k in key]).filter(t.c.tenant_id == self.tid)
            self.cache[table] = {(r[1] if len(key) == 1 else tuple(r[1:])): r[0] for r in q.all()}
        return self.cache[table].get(nk)

    def add(self, table: str, nk: Any, row_id: int) -> None:
        if table in self.cache:
            self.cache[table][nk] = row_id


def _seed_table(db: Session, tid: int, table: str, key: Tuple[str, ...], fks: Dict[str, str], ids: _Ids) -> int:
    t = Base.metadata.tables[table]
    tenant_scoped = "tenant_id" in t.c
    created = 0
    for row in load_rows(table):
        values: Dict[str, Any] = {}
        missing_parent = False
        for field, v in row.items():
            if field in fks:
                ref = ids.get(fks[field], v)
                if v is not None and ref is None and fks[field] != table:
                    missing_parent = True          # parent kept out by the tenant; skip the child
                values[f"{field}_id"] = ref
            elif field in t.c:
                values[field] = v
        if missing_parent:
            continue
        if tenant_scoped:
            values["tenant_id"] = tid
        where = [t.c[_col(k, fks)] == values.get(_col(k, fks)) for k in key]
        if tenant_scoped:
            where.append(t.c.tenant_id == tid)
        if where and db.query(t.c.id).filter(and_(*where)).first() is not None:
            continue                               # the tenant's row stands, edited or not
        if not key and db.query(t.c.id).filter(t.c.tenant_id == tid).first() is not None:
            continue                               # singleton (settings) already there
        new_id = db.execute(t.insert().values(**values).returning(t.c.id)).scalar()
        created += 1
        if len(key) == 1:
            ids.add(table, row[key[0]], new_id)
    return created


def ensure_reference_seed(db: Session, tid: int) -> Dict[str, int]:
    """Add the missing reference rows for one tenant; returns rows created per table.
    One transaction: a failure leaves the tenant as it was."""
    present = set(inspect(db.get_bind()).get_table_names())
    ids = _Ids(db, tid)
    created: Dict[str, int] = {}
    try:
        for table, key, fks in SPEC:
            if table not in present:
                logger.warning("helpdesk reference seed: %s missing, skipped (tenant %s)", table, tid)
                continue
            n = _seed_table(db, tid, table, key, fks, ids)
            if n:
                created[table] = n
        db.commit()
    except Exception:
        db.rollback()
        raise
    return created
