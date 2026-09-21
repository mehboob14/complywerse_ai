"""A register finding reaches the rest of the platform, not a list of its own.

The pen-test sheet names hosts; those hosts are in the IT asset inventory and
their weaknesses in the vulnerability register. Findings also name vendors. The
matching is deliberately narrow: a wrong link in a bank's audit register is
worse than a missing one.
"""
from datetime import date

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register.parser import parse_workbook
from grc.modules.issue_management.audit_register.service import apply_workbook

PEN_HEADERS = [
    "Project Name-Year (20XX)", "Issue ID", "Issue / Recommendation", "Source", "As of Date",
    "Issue Subject", "Condition", "Relative Risk", "LOB", "OWNER", "TYPE OF AUDIT",
    "REMEDIATION STATUS (NOT STARTED / IN PROGRESS / DELAYED / COMPLETED)",
    "ISSUE OR VULNERABILITY (FOR IT ONLY)",
    "VALIDATION STATUS (NOT STARTED/ IN PROGRESS/ CLOSED)", "Location", "Affected Hosts",
]


def _pen_workbook(tmp_path, name="pen.xlsx", *, hosts="web-api-prod", subject="IAM password policy is too short"):
    wb = Workbook()
    sheet = wb.active
    sheet.title = "IT Pen"
    sheet.append(PEN_HEADERS)
    sheet.append(["Cloud Console Review", "CLDCA.01", "Issue", "Independent Review",
                  date(2026, 1, 24), subject,
                  "Reviewed with Northwind Systems during the assessment", "Moderate", "IT/IS",
                  "ZEPHYR", "SELF ID", "IN PROGRESS", "VULNERABILITY", "NOT STARTED",
                  "us-east-1", hosts])
    path = tmp_path / name
    wb.save(path)
    return str(path)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        session.add(m.ITAsset(id=11, tenant_id=1, name="ACH API Production",
                              asset_type="server", host_name="web-api-prod"))
        session.add(m.ITAsset(id=12, tenant_id=1, name="Teller Workstation",
                              asset_type="workstation", host_name="teller-01"))
        session.add(m.Vulnerability(id=21, tenant_id=1, vuln_id="VULN-1", severity="medium",
                                    title="IAM password policy is too short",
                                    affected_host="web-api-prod"))
        session.add(m.Vulnerability(id=22, tenant_id=1, vuln_id="VULN-2", severity="low",
                                    title="Outdated TLS ciphers offered",
                                    affected_host="web-api-prod"))
        session.add(m.Vendor(id=31, tenant_id=1, name="Northwind Systems"))
        session.add(m.Vendor(id=32, tenant_id=1, name="Contoso Payments"))
        session.commit()
        yield session


def test_a_pen_test_finding_links_to_its_host_and_matching_vulnerability(db, tmp_path):
    result = apply_workbook(db, 1, parse_workbook(_pen_workbook(tmp_path)))
    db.commit()

    assert result.linked == {"assets": 1, "vulnerabilities": 1, "vendors": 1,
                             "observations": 0, "incidents": 0, "business_units": 0}
    issue = db.query(m.Issue).one()
    assert [l.asset_id for l in db.query(m.IssueAssetLink)] == [11]
    # Only the weakness that matches the finding, not every one on the host.
    assert [l.vulnerability_id for l in db.query(m.IssueVulnerabilityLink)] == [21]
    # The vendor the condition names, not the one it does not.
    assert [l.vendor_id for l in db.query(m.IssueVendorLink)] == [31]
    assert db.query(m.IssueAssetLink).one().issue_id == issue.id


def test_an_unknown_host_links_to_nothing(db, tmp_path):
    result = apply_workbook(db, 1, parse_workbook(
        _pen_workbook(tmp_path, hosts="host-we-do-not-have")))
    db.commit()

    assert result.linked["assets"] == 0
    assert db.query(m.IssueAssetLink).count() == 0
    assert db.query(m.IssueVulnerabilityLink).count() == 0


def test_re_importing_does_not_pile_up_duplicate_links(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_pen_workbook(tmp_path, "jan.xlsx")))
    db.commit()
    second = apply_workbook(db, 1, parse_workbook(_pen_workbook(tmp_path, "feb.xlsx")))
    db.commit()

    assert not any(second.linked.values())
    assert db.query(m.IssueAssetLink).count() == 1
    assert db.query(m.IssueVulnerabilityLink).count() == 1
    assert db.query(m.IssueVendorLink).count() == 1
