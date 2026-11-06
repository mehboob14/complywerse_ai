"""Saved dashboards share grc_report_definitions with saved reports.

The risk this guards is not dashboards failing — it is every report saved
before the `kind` column existed disappearing. Those rows were written with no
kind at all, so the migration leaves them NULL, and a naive
`kind = 'report'` filter excludes NULL in SQL. The Saved exports list would
come back empty for every existing user with no error anywhere.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from grc.models import ReportDefinition
from grc.modules.compliance.schema_migrations import _COLUMN_ADDS
from grc.routers.reporting_router import ReportDefIn, _kind_filter, _report_out, list_reports


def _sql(expr) -> str:
    return str(expr.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def test_report_filter_keeps_rows_saved_before_kind_existed():
    sql = _sql(_kind_filter("report"))
    assert "IS NULL" in sql, f"legacy NULL-kind reports would be hidden: {sql}"
    assert "'report'" in sql


def test_dashboard_filter_does_not_pick_up_legacy_reports():
    sql = _sql(_kind_filter("dashboard"))
    assert "IS NULL" not in sql
    assert "'dashboard'" in sql


def test_legacy_row_serialises_as_a_report():
    row = ReportDefinition(slug="old", name="Old", dataset="risks", spec={}, created_by=1)
    row.kind = None
    assert _report_out(row, 1)["kind"] == "report"


def test_a_dashboard_needs_no_dataset():
    """A dashboard draws on its tiles' reports; requiring a dataset would force
    clients to invent one."""
    body = ReportDefIn(slug="d", name="D", kind="dashboard")
    assert body.dataset == ""


def test_unknown_kind_is_rejected_not_silently_listed_as_reports():
    with pytest.raises(HTTPException) as exc:
        list_reports(kind="bogus", db=None, user=None)
    assert exc.value.status_code == 400


def test_kind_column_has_a_migration():
    """Older tenant DBs need the ALTER, or every report query raises."""
    assert any(t == "grc_report_definitions" and c == "kind" for t, c, _d, _i in _COLUMN_ADDS)
