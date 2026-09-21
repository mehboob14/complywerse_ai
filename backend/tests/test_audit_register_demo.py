"""Demo data for trying the register — and a cleanup that touches nothing real.

`cleanup` deletes rows, so the test that matters most is that it removes only
what `seed` created and leaves the tenant's own risks, assets and
vulnerabilities exactly where they were.
"""
from datetime import date

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register import demo
from grc.modules.issue_management.audit_register.parser import parse_workbook
from grc.modules.issue_management.audit_register.service import apply_workbook

PEN = ["Project Name-Year (20XX)", "Issue ID", "Issue / Recommendation", "Source",
       "Issue Subject", "Relative Risk", "OWNER", "ISSUE OR VULNERABILITY (FOR IT ONLY)",
       "Affected Hosts"]


@pytest.fixture
def db(tmp_path):
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        # The tenant's own records, which cleanup must never touch.
        session.add(m.Risk(id=500, tenant_id=1, title="Real liquidity risk", category="financial"))
        session.add(m.ITAsset(id=600, tenant_id=1, name="core-banking", asset_type="server",
                              host_name="core-banking"))
        session.add(m.Vulnerability(id=700, tenant_id=1, vuln_id="REAL-1", title="Real finding",
                                    severity="high", affected_host="core-banking"))
        session.commit()

        wb = Workbook()
        sheet = wb.active
        sheet.title = "IT Pen"
        sheet.append(PEN)
        sheet.append(["Cloud Console Review", "CLDCA.01", "Issue", "Outside Assessor",
                      "IAM password policy is too short", "Moderate", "ZEPHYR",
                      "VULNERABILITY", "web-api-prod"])
        path = tmp_path / "pen.xlsx"
        wb.save(path)
        apply_workbook(session, 1, parse_workbook(str(path)))
        session.commit()
        yield session


def test_seed_adds_risks_and_the_pen_test_hosts_then_links_them(db):
    made = demo.seed(db, 1)
    linked = demo.relink(db, 1)
    db.commit()

    assert made == {"risks": len(demo._RISKS), "assets": 1, "vulnerabilities": 1}
    assert linked["assets"] == 1 and linked["vulnerabilities"] == 1
    assert db.query(m.ITAsset).filter(m.ITAsset.host_name == "web-api-prod").count() == 1


def test_seeding_twice_adds_nothing_new(db):
    demo.seed(db, 1)
    db.commit()

    assert demo.seed(db, 1) == {"risks": 0, "assets": 0, "vulnerabilities": 0}


def test_cleanup_removes_only_the_demo_rows(db):
    demo.seed(db, 1)
    demo.relink(db, 1)
    db.commit()

    removed = demo.cleanup(db, 1)
    db.commit()

    assert removed == {"risks": len(demo._RISKS), "assets": 1, "vulnerabilities": 1}
    assert [r.id for r in db.query(m.Risk)] == [500]
    assert [a.id for a in db.query(m.ITAsset)] == [600]
    assert [v.id for v in db.query(m.Vulnerability)] == [700]
    assert db.query(m.IssueAssetLink).count() == 0            # links to demo rows went too
    assert db.query(m.IssueVulnerabilityLink).count() == 0
