"""The entry (Open) status a brand-new ticket gets is per-process: change and
service_request carry their own order-0 status ("Draft"/"Submitted"), while
incident/problem start their own list at order 1 and share the order-0 "New"
(process "shared"). _default_open_status must pick the lowest-order Open status
among {this process, "shared"}, preferring the process-specific one on a tie —
not whichever order-0 row the DB happens to return first (that mislabelled every
service_request/incident as a change's "Draft"). In-memory SQLite, direct calls.
"""
import os

os.environ.setdefault("SESSION_SECRET", "test-default-open-status")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import HDTicketStatus
from grc.modules.helpdesk_native import tickets as tk

TENANT = 1

# (label, process, order) — mirrors the seeded Open-category statuses.
_SEED = [
    ("Draft", "change", 0), ("Assess", "change", 1),
    ("Assigned", "incident", 1), ("In Progress", "incident", 2),
    ("Investigation", "problem", 1),
    ("Submitted", "service_request", 0), ("In Fulfilment", "service_request", 3),
    ("New", "shared", 0),
]


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    HDTicketStatus.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    for label, proc, order in _SEED:
        s.add(HDTicketStatus(tenant_id=TENANT, label_agent=label, category="Open",
                             process=proc, order=order, enabled=True))
    s.commit()
    yield s
    s.close()


@pytest.mark.parametrize("process,expected", [
    ("change", "Draft"),               # own order-0 wins the tie with shared "New"
    ("service_request", "Submitted"),  # own order-0 wins the tie
    ("incident", "New"),               # own list starts at 1 → shared order-0 "New"
    ("problem", "New"),                # same
])
def test_entry_status_is_process_aware(db, process, expected):
    s = tk._default_open_status(db, TENANT, process)
    assert s is not None and s.label_agent == expected


def test_no_process_falls_back_to_any_open(db):
    # Back-compat: with no process it still returns some enabled Open status.
    assert tk._default_open_status(db, TENANT) is not None
