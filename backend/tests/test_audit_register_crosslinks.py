"""A register finding also lives where the platform keeps its kind.

An MRA is kept in Statutory Audit, its status following the regulator's word;
a self-identified event is an ERM incident; a LOB is a business unit. Owner and
LOB names the file uses are mapped once, and every later import uses the map.
"""
from datetime import date

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register import mappings, workflow
from grc.modules.issue_management.audit_register.crosslinks import observation_for, sync_crosslinks
from grc.modules.issue_management.audit_register.parser import parse_workbook
from grc.modules.issue_management.audit_register.service import apply_workbook

REG = ["#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
       "Issue Name", "Issue", "Management Action Plan", "Owner", "LOB", "Target Date",
       "Status (NS/IP/DE/ PD/ EXT/CD )"]
SELF = ["Date", "Line of Business", "Executive", "Category (Fin/Ops/Reg/IT)", "Description",
        "Monetary Impact", "Risk Level ", "Issue Name"]


def _book(tmp_path, name="sep.xlsx", owner="ZEPHYR", event_date="3/31/2-26"):
    wb = Workbook()
    reg = wb.active
    reg.title = "Regulatory"
    reg.append(["AS OF", date(2026, 9, 20)])
    reg.append(REG)
    reg.append([1, "OCC", "R-1", "Report of Examination", date(2025, 5, 1), "MRA-1", "High",
                "BSA/AML risk assessment", "The OCC found gaps", "Refresh the assessment",
                owner, "BSA/AML", date(2026, 12, 31), "IP"])
    self_id = wb.create_sheet("Self ID")
    self_id.append(SELF)
    self_id.append([event_date, "Operations", "Rivera, P", "Ops", "A wire missed cut-off",
                    1250.5, "High", "Wire cut-off missed"])
    path = tmp_path / name
    wb.save(path)
    return str(path)


@pytest.fixture
def db(tmp_path):
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        session.add(m.GRCUser(id=7, username="privera", email="p.rivera@bank.example",
                              display_name="Pat Rivera", is_active=True))
        session.add(m.GRCUser(id=9, username="rblake", email="r.blake@bank.example",
                              display_name="Robin Blake", is_active=True))
        session.add(m.BusinessUnit(id=21, tenant_id=1, name="Operations"))
        session.commit()
        apply_workbook(session, 1, parse_workbook(_book(tmp_path)), actor_id=7)
        session.commit()
        yield session


def _mra(db):
    profile = db.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.source == "regulator").one()
    return profile.issue, profile


def test_an_mra_is_kept_in_statutory_audit(db, tmp_path):
    issue, _ = _mra(db)
    observation = observation_for(db, issue.id)

    assert observation.regulator_source == "OCC" and observation.category == "MRA"
    assert observation.title == "BSA/AML risk assessment"
    assert observation.management_response == "Refresh the assessment"
    assert observation.status == "in_progress"

    apply_workbook(db, 1, parse_workbook(_book(tmp_path, "oct.xlsx")), actor_id=7)
    db.commit()
    assert db.query(m.AuditObservation).count() == 1                # refreshed, not duplicated


def test_its_status_follows_validation_and_then_the_regulator(db):
    issue, profile = _mra(db)
    workflow.decide_validation(db, issue, profile, db.get(m.GRCUser, 7), "pass", "")
    assert observation_for(db, issue.id).status == "complied"       # validated, regulator to close

    profile.regulator_status = "MRA closed by regulator"
    sync_crosslinks(db, issue, profile)
    assert observation_for(db, issue.id).status == "closed"


def test_a_self_identified_event_is_an_incident_even_with_the_file_s_bad_date(db):
    profile = db.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.source == "self_id").one()
    incident = db.get(m.RiskIncident, profile.incident_id)

    assert incident.title == "Wire cut-off missed" and incident.financial_impact == 1250.5
    assert incident.incident_date.date() == date(2026, 9, 20)       # "3/31/2-26" → the pack date
    assert "Audit register" in incident.tags


def test_a_lob_with_a_unit_of_the_same_name_is_linked_and_others_are_mapped(db):
    self_id = db.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.source == "self_id").one()
    assert self_id.business_unit_id == 21                            # "Operations" exists

    result = mappings.set_lob_mapping(db, 1, "BSA/AML", create=True)
    _, profile = _mra(db)
    assert profile.business_unit_id == result["business_unit_id"]
    assert db.get(m.BusinessUnit, result["business_unit_id"]).name == "BSA/AML"


def test_an_owner_mapped_once_is_used_by_every_import(db, tmp_path):
    issue, _ = _mra(db)
    assert issue.owner_id is None                                    # "ZEPHYR" matches no one
    listed = {r["name"]: r["how"] for r in mappings.owner_mappings(db, 1)["rows"]}
    assert listed["ZEPHYR"] == "unmatched"

    moved = mappings.set_owner_mapping(db, 1, "ZEPHYR", 9)
    db.commit()
    assert moved == 1 and issue.owner_id == 9

    apply_workbook(db, 1, parse_workbook(_book(tmp_path, "oct.xlsx")), actor_id=7)
    db.commit()
    issue, _ = _mra(db)
    assert issue.owner_id == 9                                       # the import used the mapping


def test_an_incident_deleted_in_erm_is_unlinked_and_not_brought_back(db, tmp_path):
    from grc.modules.erm.routers.incidents import _clear_incident_references

    profile = db.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.source == "self_id").one()
    incident_id = profile.incident_id
    db.add(m.Risk(id=41, tenant_id=1, title="Wire risk", category="operational",
                  source_incident_id=incident_id))
    db.add(m.IncidentRiskLink(incident_id=incident_id, risk_id=41))
    db.commit()

    _clear_incident_references(db, incident_id)            # what the delete endpoint runs first
    db.delete(db.get(m.RiskIncident, incident_id))
    db.commit()

    assert db.get(m.Risk, 41).source_incident_id is None   # the risk stays, unlinked
    assert db.query(m.IncidentRiskLink).count() == 0       # the link row goes
    db.refresh(profile)
    assert profile.incident_id is None                     # the register finding stays

    apply_workbook(db, 1, parse_workbook(_book(tmp_path, "oct.xlsx")), actor_id=7)
    db.commit()
    assert db.query(m.RiskIncident).count() == 0           # next month's upload leaves it deleted
