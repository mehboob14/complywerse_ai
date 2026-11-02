"""ITSM bundle importer (Phase 1) - idempotency, fail-closed, M:N explode,
priority resolution, tenant isolation, and (when the workbook is present) the
real v3 workbook end to end.

DB harness mirrors tests/test_itsm_mobilisation.py: in-memory SQLite, creating
just the tables under test with `<table>.create(engine)`.
"""
import copy
import json
import os

import pytest
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from grc.models import (
    HDArticle, HDArticleCategory, HDBusinessService, HDCABConfig,
    HDChangeRiskMatrix, HDChangeType, HDCIAttribute,
    HDConfigurationItem, HDCIRelationship, HDCIRelationshipType, HDCIType,
    HDDepartment, HDImportBatch, HDIncidentCategory, HDKPI, HDPriorityMatrix,
    HDProcessField, HDRaci, HDRequestItem, HDRoleMap,
    HDServiceCategory, HDServiceDependency, HDSLATarget, HDStateTransition,
    HDSupportGroupMap, HDTechnicalService, HDTicketPriority, HDTicketStatus,
    Team,
)
from grc.modules.helpdesk_native import itsm_bundle_export as exp
from grc.modules.helpdesk_native.itsm_import import import_bundle

TENANT = 1

# every table the importer can write (catalogue + the two mutated engine tables)
CATALOGUE = (
    HDServiceCategory, HDBusinessService, HDTechnicalService, HDServiceDependency,
    HDRequestItem, HDCIType, HDCIAttribute, HDConfigurationItem,
    HDCIRelationshipType, HDCIRelationship, HDPriorityMatrix, HDStateTransition,
    HDChangeType, HDChangeRiskMatrix, HDSupportGroupMap, HDRoleMap,
    HDIncidentCategory,
    HDSLATarget, HDProcessField, HDRaci, HDCABConfig,
    HDDepartment, HDArticleCategory, HDArticle, HDKPI,
    HDTicketPriority, HDTicketStatus,
)
ALL_TABLES = (HDImportBatch, Team) + CATALOGUE


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in ALL_TABLES:
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


@pytest.fixture
def seed_sample_cis(monkeypatch):
    """Opt in to the workbook's illustrative sample_cis / sample_ci_relationships.
    They are OFF by default (demo data must not flow into the CMDB — see
    test_sample_cis_blocked_by_default); the tests that exercise the CI
    graph/relationship import logic flip the flag on explicitly."""
    import grc.modules.helpdesk_native.itsm_import as mod
    monkeypatch.setattr(mod, "SEED_SAMPLE_CIS", True)


def counts(db):
    return {m.__tablename__: db.query(m).count() for m in CATALOGUE}


def small_bundle():
    """Hand-built bundle using the workbook's own (snake_case) column names."""
    e = {
        "support_groups": [
            {"group_id": "GRP-MSG", "name": "Messaging & Collaboration (L2)"},
            {"group_id": "GRP-NET", "name": "Network (L2/L3)"},
        ],
        "roles": [{"role_id": "ROLE-CHGMGR", "name": "Change Manager", "description": "Owns change"}],
        "service_categories": [{"category_id": "CAT-COLLAB", "name": "Email & Collaboration"}],
        "business_services": [
            {"service_id": "SVC-0001", "name": "Corporate Email", "category_id": "CAT-COLLAB",
             "support_group_id": "GRP-MSG", "criticality": "Critical", "industry": "All", "status": "Active"},
            {"service_id": "SVC-0002", "name": "VPN", "category_id": "CAT-COLLAB",
             "support_group_id": "GRP-NET", "criticality": "High", "industry": "All", "status": "Active"},
        ],
        "technical_services": [
            {"service_id": "SVC-T001", "name": "Directory", "support_group_id": "GRP-NET",
             "supports_business_service_id": "SVC-0001, SVC-0002", "status": "Active"},
            {"service_id": "SVC-T002", "name": "Mail Transport", "support_group_id": "GRP-MSG",
             "supports_business_service_id": "SVC-0001", "status": "Active"},
        ],
        "request_offerings": [
            {"request_id": "REQ-001", "name": "New Mailbox", "service_id": "SVC-0001",
             "approval_required": "Yes", "approver_role": "Line Manager",
             "fulfilment_group_id": "GRP-MSG", "fulfilment_sla_hours": 8, "status": "Active"},
        ],
        "ci_types": [
            {"cit_id": "CIT-VM", "name": "Virtual Machine", "parent_cit_id": "CIT-SERVER"},  # parent declared AFTER child
            {"cit_id": "CIT-SERVER", "name": "Server"},
        ],
        "ci_attributes": [
            {"cit_id": "CIT-VM", "attribute": "os", "datatype": "Enum", "required": "Yes",
             "description": "Windows/Linux"},
        ],
        "ci_relationship_types": [
            {"rel_id": "REL-RUNSON", "name": "Runs on", "inverse_name": "Runs"},
            {"rel_id": "REL-REALISES", "name": "Realises", "inverse_name": "Realised by"},
        ],
        "sample_cis": [
            {"ci_id": "CI-0001", "cit_id": "CIT-VM", "name": "MAIL-01", "ci_status": "Active",
             "environment": "Prod", "owner_group_id": "GRP-MSG", "criticality": "Critical"},
            {"ci_id": "CI-0002", "cit_id": "CIT-SERVER", "name": "HOST-01", "ci_status": "Active",
             "environment": "Prod", "owner_group_id": "GRP-NET", "criticality": "High"},
        ],
        "sample_ci_relationships": [
            {"source_ci_id": "CI-0001", "rel_id": "REL-RUNSON", "target_id": "CI-0002"},
            {"source_ci_id": "CI-0001", "rel_id": "REL-REALISES", "target_id": "SVC-0001"},
        ],
        "priority_matrix": [
            {"impact": "High", "urgency": "High", "priority": "P1 - Critical"},
            {"impact": "High", "urgency": "Low", "priority": "P3 - Medium"},
            {"impact": "Low", "urgency": "Low", "priority": "P5 - Planning"},
        ],
        "incident_states": [
            {"state": "New", "description": "Logged", "allowed_next": "Assigned, Cancelled"},
            {"state": "Assigned", "description": "x", "allowed_next": "Resolved, Cancelled"},
            {"state": "Resolved", "description": "x", "allowed_next": "Closed, Assigned (reopen)"},
            {"state": "Closed", "description": "x", "allowed_next": "(terminal)"},
            {"state": "Cancelled", "description": "x", "allowed_next": "(terminal)"},
        ],
        "problem_states": [
            {"state": "New", "description": "x", "allowed_next": "Closed"},
            {"state": "Closed", "description": "x", "allowed_next": "(terminal)"},
        ],
        "change_types": [
            {"change_type": "Standard", "description": "Pre-approved", "authorisation": "No CAB (pre-authorised model)"},
            {"change_type": "Normal", "description": "Via CAB", "authorisation": "CAB required"},
        ],
        "change_risk_matrix": [
            {"likelihood": "High", "impact": "High", "risk_level": "Very High"},
            {"likelihood": "Low", "impact": "Low", "risk_level": "Very Low"},
        ],
        "incident_categories": [
            {"category": "Email", "subcategory": "Mailbox", "example_item": "Mailbox full"},
            {"category": "Email", "subcategory": "Mailbox", "example_item": "Cannot send or receive"},
            {"category": "Email", "subcategory": "Spam/Phishing", "example_item": "Phishing reported"},
            {"category": "Hardware", "subcategory": "Laptop", "example_item": "Won't power on"},
            {"category": "Network"},   # category-only row (no subcategory/item)
        ],
        "performance_kpis": [
            {"process": "Incident", "kpi": "Mean Time to Resolve", "definition": "Avg New->Resolved",
             "target": "P1 < 4h", "frequency": "Monthly"},
            {"process": "Change", "kpi": "Change Success Rate", "definition": "% changes with no incident",
             "target": ">= 95%", "frequency": "Monthly"},
        ],
        "sla_targets": [
            {"process": "Incident", "priority_or_type": "P1 – Critical", "response_target": "15 min",
             "resolution_target": "4 hours", "service_window": "24x7", "notes": "Major incident bridge"},
            {"process": "Incident", "priority_or_type": "P3 – Medium", "response_target": "4 hours",
             "resolution_target": "2 business days", "service_window": "Business hours", "notes": "Standard"},
            {"process": "Change", "priority_or_type": "Standard", "response_target": "Pre-approved",
             "resolution_target": "Per plan", "service_window": "Business hours", "notes": "Pre-authorised"},
        ],
        "incident_fields": [
            {"field": "Incident ID", "type": "Auto", "required": "Yes", "description": "Unique reference"},
            {"field": "Priority", "type": "Enum", "required": "Yes", "description": "P1..P5"},
        ],
        "problem_fields": [
            {"field": "Problem ID", "type": "Auto", "required": "Yes", "description": "PRBxxxxxxx"},
        ],
        "change_fields": [
            {"field": "Change ID", "type": "Auto", "required": "Yes", "description": "CHGxxxxxxx"},
            {"field": "Change type", "type": "Ref:change_types", "required": "Yes", "description": "Standard/Normal"},
        ],
        "incident_raci": [
            {"process": "Incident", "activity": "Log & classify", "responsible": "ROLE-AGENT",
             "accountable": "ROLE-INCMGR", "consulted": "ROLE-REQ", "informed": "ROLE-SVCOWN"},
        ],
        "request_raci": [
            {"process": "Service Request", "activity": "Approve", "responsible": "ROLE-APPROVER",
             "accountable": "ROLE-SVCOWN", "consulted": "ROLE-AGENT", "informed": "ROLE-REQ"},
        ],
        "problem_raci": [
            {"process": "Problem", "activity": "Root-cause analysis", "responsible": "ROLE-SME",
             "accountable": "ROLE-PRBMGR", "consulted": "ROLE-TECH", "informed": "ROLE-SVCOWN"},
        ],
        "change_raci": [
            {"process": "Change", "activity": "Authorise", "responsible": "ROLE-CABMEM",
             "accountable": "ROLE-CHGMGR", "consulted": "ROLE-SVCOWN", "informed": "ROLE-SDMGR"},
        ],
        "change_cab": [
            {"item": "Chair", "detail": "Change Manager (ROLE-CHGMGR)"},
            {"item": "CAB cadence", "detail": "Weekly; ECAB on demand"},
        ],
        "departments": [
            {"department_id": "DEPT-IT", "name": "Information Technology", "code": "IT",
             "parent_department_id": None, "default_support_group_id": "GRP-NET",
             "self_service_created": "No", "status": "Active", "seeded": "Yes"},
            {"department_id": "DEPT-MKT", "name": "Marketing", "code": "MKT",
             "parent_department_id": None, "default_support_group_id": None,
             "self_service_created": "No", "status": "Active", "seeded": "Yes"},
        ],
        "kb_categories": [
            {"kb_category_id": "KBC-GETTING", "name": "Getting Started & Accounts"},
        ],
        "kb_articles": [
            {"kb_id": "KB-001", "kb_category_id": "KBC-GETTING", "title": "Reset your password",
             "audience": "End User", "level": "Entry", "symptom": "Cannot sign in.",
             "cause": "Expired password.", "resolution": "Use the self-service portal.",
             "related_service_id": "SVC-9999",   # intentionally dangling: must NOT fail the import
             "tags": "password,login", "status": "Published"},
        ],
    }
    return {"bundle_version": "test-1", "source_filename": "hand.xlsx",
            "checksum": exp.compute_checksum(e), "entities": e}


# --- (a) idempotency ----------------------------------------------------------------
def test_reimport_same_bundle_is_idempotent(db, seed_sample_cis):
    b = small_bundle()
    first = import_bundle(db, TENANT, b, "u@x.com")
    assert first.status == "applied" and first.imported_at is not None
    assert first.summary["business_services"]["inserted"] == 2
    after_first = counts(db)
    assert all(n > 0 for t, n in after_first.items()), after_first

    second = import_bundle(db, TENANT, copy.deepcopy(b), "u@x.com")
    assert second.status == "applied" and second.id != first.id
    assert counts(db) == after_first                         # identical row counts
    for ent, st in second.summary.items():
        if ent.startswith("_"):
            continue
        assert st["inserted"] == 0 and st["updated"] == 0, (ent, st)   # true no-op
    # unchanged rows keep the batch that wrote them (not re-stamped)
    svc = db.query(HDBusinessService).filter_by(tenant_id=TENANT, code="SVC-0001").one()
    assert svc.source_batch_id == first.id


def test_changed_row_updates_in_place_and_restamps(db):
    b = small_bundle()
    first = import_bundle(db, TENANT, b)
    b2 = copy.deepcopy(b)
    b2["entities"]["business_services"][0]["name"] = "Corporate Email v2"
    b2["checksum"] = exp.compute_checksum(b2["entities"])
    second = import_bundle(db, TENANT, b2)
    assert second.summary["business_services"] == {"inserted": 0, "updated": 1, "skipped": 1}
    row = db.query(HDBusinessService).filter_by(tenant_id=TENANT, code="SVC-0001").one()
    assert row.name == "Corporate Email v2" and row.source_batch_id == second.id
    assert db.query(HDBusinessService).count() == 2


def test_every_upserted_row_is_stamped_with_its_batch(db, seed_sample_cis):
    batch = import_bundle(db, TENANT, small_bundle())
    for m in CATALOGUE:
        if not hasattr(m, "source_batch_id") or m in (HDTicketPriority, HDTicketStatus):
            continue
        rows = db.query(m).all()
        assert rows, m.__tablename__
        assert all(r.source_batch_id == batch.id for r in rows), m.__tablename__


# --- (b) fail-closed -----------------------------------------------------------------
def test_dangling_ref_fails_closed_and_commits_nothing(db):
    b = small_bundle()
    b["entities"]["request_offerings"].append(
        {"request_id": "REQ-999", "name": "Ghost", "service_id": "SVC-9999", "status": "Active"})
    b["checksum"] = exp.compute_checksum(b["entities"])
    with pytest.raises(ValueError) as ei:
        import_bundle(db, TENANT, b, "u@x.com")
    assert "SVC-9999" in str(ei.value)

    # NOT ONE catalogue row survived, including the valid ones written before the bad row
    assert all(n == 0 for n in counts(db).values()), counts(db)
    batch = db.query(HDImportBatch).one()
    assert batch.status == "failed"
    errs = json.loads(batch.error)
    assert any(e["ref"] == "SVC-9999" and e["entity"] == "request_items" for e in errs)


def test_collects_every_dangling_ref_not_just_the_first(db, seed_sample_cis):
    b = small_bundle()
    b["entities"]["technical_services"][0]["supports_business_service_id"] = "SVC-0001, SVC-8888"
    b["entities"]["sample_ci_relationships"].append(
        {"source_ci_id": "CI-0001", "rel_id": "REL-NOPE", "target_id": "CI-7777"})
    b["checksum"] = exp.compute_checksum(b["entities"])
    with pytest.raises(ValueError):
        import_bundle(db, TENANT, b)
    refs = {e["ref"] for e in json.loads(db.query(HDImportBatch).one().error)}
    assert {"SVC-8888", "REL-NOPE", "CI-7777"} <= refs
    assert all(n == 0 for n in counts(db).values())


def test_failed_reimport_leaves_prior_good_import_untouched(db):
    good = import_bundle(db, TENANT, small_bundle())
    before = counts(db)
    bad = small_bundle()
    bad["entities"]["request_offerings"][0]["service_id"] = "SVC-0000"
    bad["entities"]["business_services"][0]["name"] = "SHOULD NOT PERSIST"
    bad["checksum"] = exp.compute_checksum(bad["entities"])
    with pytest.raises(ValueError):
        import_bundle(db, TENANT, bad)
    assert counts(db) == before
    row = db.query(HDBusinessService).filter_by(tenant_id=TENANT, code="SVC-0001").one()
    assert row.name == "Corporate Email" and row.source_batch_id == good.id


def test_checksum_mismatch_is_rejected(db):
    b = small_bundle()
    b["entities"]["roles"][0]["name"] = "tampered"       # checksum now stale
    with pytest.raises(ValueError, match="checksum"):
        import_bundle(db, TENANT, b)
    assert db.query(HDImportBatch).one().status == "failed"
    assert all(n == 0 for n in counts(db).values())


# --- (c) M:N explode ----------------------------------------------------------------
def test_many_to_many_dependencies_explode(db):
    import_bundle(db, TENANT, small_bundle())
    email = db.query(HDBusinessService).filter_by(tenant_id=TENANT, code="SVC-0001").one()
    deps = db.query(HDServiceDependency).filter_by(business_service_id=email.id).all()
    assert len(deps) > 1
    codes = {db.get(HDTechnicalService, d.technical_service_id).code for d in deps}
    assert codes == {"SVC-T001", "SVC-T002"}
    # and one technical service underpins many business services
    t1 = db.query(HDTechnicalService).filter_by(tenant_id=TENANT, code="SVC-T001").one()
    assert db.query(HDServiceDependency).filter_by(technical_service_id=t1.id).count() == 2
    assert db.query(HDServiceDependency).count() == 3


def test_ci_graph_and_service_realisation(db, seed_sample_cis):
    import_bundle(db, TENANT, small_bundle())
    # CI->CI edge persisted; CI->service (REALISES) carried on the CI, not as an edge
    assert db.query(HDCIRelationship).count() == 1
    ci = db.query(HDConfigurationItem).filter_by(tenant_id=TENANT, code="CI-0001").one()
    assert db.get(HDBusinessService, ci.business_service_id).code == "SVC-0001"
    # child type declared before its parent still got linked
    vm = db.query(HDCIType).filter_by(tenant_id=TENANT, code="CIT-VM").one()
    assert db.get(HDCIType, vm.parent_id).code == "CIT-SERVER"
    attr = db.query(HDCIAttribute).filter_by(ci_type_id=vm.id).one()
    assert attr.datatype == "enum" and attr.required is True and attr.options == ["Windows", "Linux"]


def test_sample_cis_blocked_by_default(db):
    """Owner fix / regression lock: the workbook's sample_cis + sample_ci_relationships
    are DEMO data and must NOT flow into the CMDB under the default
    (SEED_SAMPLE_CIS=False). Real CIs come from ComplyVerse inventory sync, not the workbook.
    The CI *types*, *attributes* and *relationship types* ARE standard CMDB
    scaffolding and must still be seeded."""
    batch = import_bundle(db, TENANT, small_bundle())
    assert batch.status == "applied"
    # no demo CI instances or CI<->CI relationships leaked in
    assert db.query(HDConfigurationItem).count() == 0
    assert db.query(HDCIRelationship).count() == 0
    # standard CMDB scaffolding still present
    assert db.query(HDCIType).count() == 2
    assert db.query(HDCIAttribute).count() == 1
    assert db.query(HDCIRelationshipType).count() == 2


# --- (d) priorities -------------------------------------------------------------------
def test_priority_matrix_cell_resolves_to_ticket_priority(db):
    # an existing seeded priority ("Urgent") must be MATCHED and stamped, not duplicated
    db.add(HDTicketPriority(tenant_id=TENANT, name="Urgent", level="Urgent"))
    db.commit()
    import_bundle(db, TENANT, small_bundle())

    cell = db.query(HDPriorityMatrix).filter_by(tenant_id=TENANT, impact="high", urgency="high").one()
    pri = db.get(HDTicketPriority, cell.priority_id)
    assert pri.code == "P1" and pri.rank == 1 and pri.name == "Urgent"
    assert db.query(HDTicketPriority).filter_by(tenant_id=TENANT, name="Urgent").count() == 1
    low = db.query(HDPriorityMatrix).filter_by(tenant_id=TENANT, impact="low", urgency="low").one()
    assert db.get(HDTicketPriority, low.priority_id).code == "P5"        # created
    assert db.query(HDTicketPriority).filter_by(tenant_id=TENANT).count() == 3   # Urgent, P3, P5


# --- states / change / mapping ---------------------------------------------------------
def test_state_machine_as_data(db):
    import_bundle(db, TENANT, small_bundle())
    st = {s.label_agent: s for s in db.query(HDTicketStatus).filter_by(tenant_id=TENANT)}
    assert st["New"].is_initial and st["New"].process == "shared"    # used by incident AND problem
    assert st["Closed"].is_terminal and st["Closed"].category == "Resolved"
    assert st["Assigned"].process == "incident" and not st["Assigned"].is_terminal

    def tr(proc, a, b):
        return (db.query(HDStateTransition)
                .filter_by(tenant_id=TENANT, process=proc, from_status_id=st[a].id, to_status_id=st[b].id)
                .first())
    assert tr("incident", "New", "Assigned") is not None
    assert tr("incident", "New", "Closed") is None                    # illegal jump absent
    assert tr("incident", "Resolved", "Assigned").guard == "reopen"   # '(reopen)' -> guard
    assert tr("problem", "New", "Closed") is not None


def test_change_types_and_risk_matrix(db):
    import_bundle(db, TENANT, small_bundle())
    std = db.query(HDChangeType).filter_by(tenant_id=TENANT, code="standard").one()
    nrm = db.query(HDChangeType).filter_by(tenant_id=TENANT, code="normal").one()
    assert (std.requires_cab, std.auto_approve) == (False, True)
    assert (nrm.requires_cab, nrm.auto_approve) == (True, False)
    vh = db.query(HDChangeRiskMatrix).filter_by(tenant_id=TENANT, impact="high", likelihood="high").one()
    assert vh.risk_level == "very_high" and vh.cab_required is True
    assert db.query(HDChangeRiskMatrix).filter_by(tenant_id=TENANT, risk_level="very_low").one().cab_required is False


def test_support_group_resolves_to_team_and_warns_when_unmatched(db):
    db.add(Team(tenant_id=TENANT, name="Network (L2/L3)"))
    db.commit()
    batch = import_bundle(db, TENANT, small_bundle())
    team = db.query(Team).one()
    net = db.query(HDSupportGroupMap).filter_by(tenant_id=TENANT, code="GRP-NET").one()
    msg = db.query(HDSupportGroupMap).filter_by(tenant_id=TENANT, code="GRP-MSG").one()
    assert net.team_id == team.id and msg.team_id is None
    assert any("GRP-MSG" in w for w in batch.summary["_warnings"])
    # fulfilment/owner team falls out of the group's team
    ts = db.query(HDTechnicalService).filter_by(tenant_id=TENANT, code="SVC-T001").one()
    assert ts.owner_team_id == team.id
    # an admin-set mapping is never clobbered by a later import that can't match
    msg.team_id = team.id
    db.commit()
    import_bundle(db, TENANT, small_bundle())
    assert db.get(HDSupportGroupMap, msg.id).team_id == team.id


def test_tenants_are_isolated(db):
    import_bundle(db, 1, small_bundle())
    import_bundle(db, 2, small_bundle())
    for m in (HDBusinessService, HDTechnicalService, HDRequestItem, HDCIType, HDRoleMap):
        assert db.query(m).filter_by(tenant_id=1).count() == db.query(m).filter_by(tenant_id=2).count() > 0
        assert db.query(m).count() == 2 * db.query(m).filter_by(tenant_id=1).count()
    # a tenant-2 reference can never resolve to a tenant-1 row
    b = small_bundle()
    b["entities"]["request_offerings"][0]["service_id"] = "SVC-0001"
    db.query(HDBusinessService).filter_by(tenant_id=3).delete()
    only_reqs = {"entities": {"request_offerings": b["entities"]["request_offerings"]}}
    with pytest.raises(ValueError):
        import_bundle(db, 3, only_reqs)


# --- incident classification tree -----------------------------------------------------
def test_incident_category_tree(db):
    import_bundle(db, TENANT, small_bundle())
    allc = db.query(HDIncidentCategory).filter_by(tenant_id=TENANT).all()
    by_key = {c.key: c for c in allc}
    # category node, no parent
    assert by_key["email"].level == "category" and by_key["email"].parent_id is None
    # subcategory parented to its category
    assert by_key["email/mailbox"].level == "subcategory"
    assert by_key["email/mailbox"].parent_id == by_key["email"].id
    # leaf item parented to its subcategory, display name preserved
    full = by_key["email/mailbox/mailbox_full"]
    assert full.level == "item" and full.name == "Mailbox full"
    assert full.parent_id == by_key["email/mailbox"].id
    # two items share the one Mailbox subcategory (no duplicate subcategory node)
    lv = lambda l: sum(1 for c in allc if c.level == l)  # noqa: E731
    assert (lv("category"), lv("subcategory"), lv("item")) == (3, 3, 4)
    # a category-only row has no children
    net = by_key["network"]
    assert net.level == "category" and not any(c.parent_id == net.id for c in allc)


def test_incident_categories_idempotent(db):
    import_bundle(db, TENANT, small_bundle())
    n = db.query(HDIncidentCategory).count()
    assert n == 10                                           # 3 categories + 3 subcategories + 4 items
    second = import_bundle(db, TENANT, copy.deepcopy(small_bundle()))
    assert db.query(HDIncidentCategory).count() == n         # no new rows
    st = second.summary["incident_categories"]
    assert st["inserted"] == 0 and st["updated"] == 0        # true no-op (skipped counts upsert calls, not rows)


# --- Phase 2 continuation: SLA targets / process fields / RACI / CAB / departments / KB -------
def test_sla_targets_parse_minutes_and_priority_code(db):
    import_bundle(db, TENANT, small_bundle())
    p1 = db.query(HDSLATarget).filter_by(tenant_id=TENANT, process="incident",
                                          priority_label="P1 – Critical").one()
    assert p1.priority_code == "P1" and p1.service_window == "24x7"
    assert (p1.response_minutes, p1.resolution_minutes) == (15, 240)
    p3 = db.query(HDSLATarget).filter_by(tenant_id=TENANT, process="incident",
                                          priority_label="P3 – Medium").one()
    assert (p3.response_minutes, p3.resolution_minutes) == (240, 960)      # 2 business days = 2*480
    standard = db.query(HDSLATarget).filter_by(tenant_id=TENANT, process="change",
                                                priority_label="Standard").one()
    assert standard.priority_code is None                                  # not a P-code
    assert standard.response_minutes is None and standard.resolution_minutes is None  # prose targets
    assert db.query(HDSLATarget).count() == 3


def test_process_fields_per_process(db):
    import_bundle(db, TENANT, small_bundle())
    assert db.query(HDProcessField).filter_by(tenant_id=TENANT, process="incident").count() == 2
    assert db.query(HDProcessField).filter_by(tenant_id=TENANT, process="problem").count() == 1
    chg = db.query(HDProcessField).filter_by(tenant_id=TENANT, process="change",
                                              name="Change type").one()
    assert chg.field_type == "Ref:change_types" and chg.required is True
    pid = db.query(HDProcessField).filter_by(tenant_id=TENANT, process="incident",
                                              name="Incident ID").one()
    assert pid.field_type == "Auto" and pid.required is True


def test_raci_stored_per_process(db):
    import_bundle(db, TENANT, small_bundle())
    assert db.query(HDRaci).count() == 4
    chg = db.query(HDRaci).filter_by(tenant_id=TENANT, process="change", activity="Authorise").one()
    assert chg.responsible == "ROLE-CABMEM" and chg.accountable == "ROLE-CHGMGR"
    req = db.query(HDRaci).filter_by(tenant_id=TENANT, process="service_request").one()
    assert req.activity == "Approve"


def test_cab_config_key_value(db):
    import_bundle(db, TENANT, small_bundle())
    chair = db.query(HDCABConfig).filter_by(tenant_id=TENANT, item="Chair").one()
    assert chair.detail == "Change Manager (ROLE-CHGMGR)"
    assert db.query(HDCABConfig).count() == 2


def test_department_resolves_to_team_and_is_idempotent(db):
    db.add(Team(tenant_id=TENANT, name="Network (L2/L3)"))
    db.commit()
    team = db.query(Team).one()
    first = import_bundle(db, TENANT, small_bundle())
    it = db.query(HDDepartment).filter_by(tenant_id=TENANT, code="IT").one()
    assert it.name == "Information Technology" and it.default_team_id == team.id
    mkt = db.query(HDDepartment).filter_by(tenant_id=TENANT, code="MKT").one()
    assert mkt.default_team_id is None
    n = db.query(HDDepartment).count()

    second = import_bundle(db, TENANT, copy.deepcopy(small_bundle()))
    assert db.query(HDDepartment).count() == n
    st = second.summary.get("departments", {"inserted": 0, "updated": 0})
    assert st["inserted"] == 0 and st["updated"] == 0

    # an admin-set team is never clobbered by a later import whose group has no match
    mkt.default_team_id = team.id
    db.commit()
    import_bundle(db, TENANT, small_bundle())
    assert db.get(HDDepartment, mkt.id).default_team_id == team.id
    assert first.status == "applied"


def test_kb_category_and_article_composed(db):
    import_bundle(db, TENANT, small_bundle())
    cat = db.query(HDArticleCategory).filter_by(tenant_id=TENANT, code="KBC-GETTING").one()
    assert cat.category_name == "Getting Started & Accounts"
    art = db.query(HDArticle).filter_by(tenant_id=TENANT, code="KB-001").one()
    assert art.title == "Reset your password" and art.category_id == cat.id
    assert art.status == "Published"
    assert "## Symptom" in art.content and "Cannot sign in." in art.content
    assert "## Cause" in art.content and "## Resolution" in art.content
    assert "**Tags:** password,login" in art.content


def test_kb_article_ignores_dangling_related_service_id(db):
    # related_service_id "SVC-9999" (set in small_bundle) resolves nowhere and
    # has no column to validate against -> the import must still succeed.
    batch = import_bundle(db, TENANT, small_bundle())
    assert batch.status == "applied"


def test_sla_fields_raci_cab_kb_are_idempotent(db):
    import_bundle(db, TENANT, small_bundle())
    n = counts(db)
    second = import_bundle(db, TENANT, copy.deepcopy(small_bundle()))
    assert counts(db) == n
    for ent in ("sla_targets", "process_fields", "raci", "cab", "kb_categories", "kb_articles"):
        st = second.summary.get(ent, {"inserted": 0, "updated": 0})
        assert st["inserted"] == 0 and st["updated"] == 0, (ent, st)


# --- real workbook (skipped where it is not present) -------------------------------------
V3 = os.path.join(exp.DOWNLOADS, "AVA_ServiceDesk_ITSM_enriched_v3.xlsx")


@pytest.mark.skipif(not os.path.isfile(V3), reason="v3 workbook not on this machine")
def test_real_v3_workbook_imports_and_is_idempotent(db):
    b = exp.export_workbook(V3)
    assert b["checksum"] == exp.compute_checksum(b["entities"])
    assert exp.export_workbook(V3)["checksum"] == b["checksum"]       # deterministic
    first = import_bundle(db, TENANT, b)
    assert first.status == "applied"
    assert db.query(HDBusinessService).count() == 87
    assert db.query(HDTechnicalService).count() == 119
    assert db.query(HDRequestItem).count() == 192
    assert db.query(HDServiceDependency).count() > db.query(HDTechnicalService).count()   # M:N
    assert db.query(HDPriorityMatrix).count() == 9
    # incident classification tree built from the 223 rows of sheet 16
    email = db.query(HDIncidentCategory).filter_by(tenant_id=TENANT, key="email", level="category").one()
    assert db.query(HDIncidentCategory).filter_by(parent_id=email.id).count() > 0   # has subcategories
    assert db.query(HDIncidentCategory).filter_by(tenant_id=TENANT, level="item").count() > 100
    # Phase 2 continuation sheets (08/15/17/19/21/22/25/27/28/31/32/33)
    assert db.query(HDSLATarget).count() == 11
    assert db.query(HDProcessField).count() == 30 + 17 + 22
    assert db.query(HDRaci).count() == 28
    assert db.query(HDCABConfig).count() == 10
    assert db.query(HDDepartment).count() == 15
    assert db.query(HDArticle).count() == 57
    assert db.query(HDKPI).count() == 28          # sheet 29 — now ingested (no longer deferred)
    n = counts(db)
    second = import_bundle(db, TENANT, b)
    assert counts(db) == n
    assert all(s["inserted"] == 0 and s["updated"] == 0
               for k, s in second.summary.items() if not k.startswith("_"))
