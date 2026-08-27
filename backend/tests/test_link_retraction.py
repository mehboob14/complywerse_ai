"""Evidence retraction — the soft-vs-hard invariant, promoted from live
inspection into the permanent suite (audit divergence #3).

Until now the rule was verified only by eyeballing the dev DB after a re-map;
nothing failed if the modes silently swapped. Locked here, hermetically:

  * mode="hard" (manual unlink — a human said the link is wrong) DELETES the
    evidence row; it is gone from the table and from tier derivation.
  * mode="soft" (rule-driven prune — rules fluctuate) KEEPS the row, stamps
    `retracted_at`, and hides it from tier derivation (tier_for_ref).
  * reinstate un-retracts a soft row and it becomes visible to derivation
    again — the crosswalk-edit round-trip must not permanently degrade a badge.
  * an already-soft-retracted row is not re-retracted (idempotent).

If these two modes ever invert, THIS test fails — not a person re-running a
one-off query.
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import ControlEffectivenessEvidence, AuditLog
from grc.services.control_assurance import (
    retract_link_evidence, reinstate_link_evidence, tier_for_ref,
)

TENANT = 1
PFC = 555  # a parsed_framework_control id
VULN = 900


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for model in (ControlEffectivenessEvidence, AuditLog):
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _pass(db, when_days_ago=1):
    """One genuine PASS evidence row on (VULN, PFC) — derives to tested_effective."""
    row = ControlEffectivenessEvidence(
        tenant_id=TENANT, vulnerability_id=VULN, parsed_framework_control_id=PFC,
        source_type="retest", result="pass",
        tested_at=datetime.utcnow() - timedelta(days=when_days_ago),
    )
    db.add(row); db.commit()
    return row


REF = {"parsed_framework_control_id": PFC}


def test_soft_keeps_row_and_hides_from_derivation(db):
    _pass(db)
    assert tier_for_ref(db, TENANT, "parsed_framework_control", PFC)["tier"] == "tested_effective"

    n = retract_link_evidence(db, tenant_id=TENANT, vulnerability_id=VULN,
                              control_ref=REF, reason="auto_link_stale_removed", mode="soft")
    db.commit()
    assert n == 1
    # row is STILL THERE, just stamped
    rows = db.query(ControlEffectivenessEvidence).all()
    assert len(rows) == 1 and rows[0].retracted_at is not None, "soft must keep the row"
    # …and derivation no longer sees it
    assert tier_for_ref(db, TENANT, "parsed_framework_control", PFC)["tier"] == "attested_only"


def test_hard_deletes_row(db):
    _pass(db)
    n = retract_link_evidence(db, tenant_id=TENANT, vulnerability_id=VULN,
                              control_ref=REF, reason="manual_unlink", mode="hard")
    db.commit()
    assert n == 1
    assert db.query(ControlEffectivenessEvidence).count() == 0, "hard must delete the row"


def test_reinstate_restores_soft_row(db):
    _pass(db)
    retract_link_evidence(db, tenant_id=TENANT, vulnerability_id=VULN,
                          control_ref=REF, mode="soft"); db.commit()
    assert tier_for_ref(db, TENANT, "parsed_framework_control", PFC)["tier"] == "attested_only"

    restored = reinstate_link_evidence(db, tenant_id=TENANT, vulnerability_id=VULN,
                                       control_ref=REF, reason="auto_link_recreated")
    db.commit()
    assert restored == 1
    assert db.query(ControlEffectivenessEvidence).first().retracted_at is None
    # visible to derivation again
    assert tier_for_ref(db, TENANT, "parsed_framework_control", PFC)["tier"] == "tested_effective"


def test_soft_is_idempotent(db):
    _pass(db)
    first = retract_link_evidence(db, tenant_id=TENANT, vulnerability_id=VULN, control_ref=REF, mode="soft")
    db.commit()
    second = retract_link_evidence(db, tenant_id=TENANT, vulnerability_id=VULN, control_ref=REF, mode="soft")
    db.commit()
    assert first == 1 and second == 0, "an already-retracted row is not re-retracted"


def test_hard_cannot_be_reinstated(db):
    # a hard delete is final — there is no row to un-retract.
    _pass(db)
    retract_link_evidence(db, tenant_id=TENANT, vulnerability_id=VULN, control_ref=REF, mode="hard"); db.commit()
    assert reinstate_link_evidence(db, tenant_id=TENANT, vulnerability_id=VULN, control_ref=REF) == 0
