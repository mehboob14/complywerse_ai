"""Field policies: every column is classified, a use case sees only what it declared, and nothing marked never-sent
gets through."""
import json
from datetime import date, datetime

import pytest

import grc.models as m
from grc.services.ai_gateway import field_policies as fp
from grc.services.ai_gateway import registry

NOW = datetime(2026, 10, 13, 12, 0)


def test_every_column_of_every_record_type_has_a_code():
    for name, policy in fp.POLICIES.items():
        columns = {c.name for c in getattr(m, name).__table__.columns}
        assert not columns - set(policy.columns), f"{name}: classify {sorted(columns - set(policy.columns))}"
        assert not set(policy.columns) - columns, f"{name}: no such column {sorted(set(policy.columns) - columns)}"
        assert set(policy.columns.values()) <= set(fp.CODES)


def test_the_record_types_the_user_asked_for_are_covered():
    assert {"Risk", "RiskIncident", "CriticalTask", "CriticalTaskComment", "ITAsset", "Vulnerability",
            "ComplianceAssessmentDocumentItem", "ComplianceAssessmentDocument", "AssessmentItem",
            "GRCComplianceAssessment"} <= set(fp.POLICIES)


def test_a_use_case_names_only_registered_use_cases_and_columns_it_is_allowed_to_send():
    seen = 0
    for model, use_case, spec in fp.declared():
        seen += 1
        column, cap = fp._spec(spec)
        policy = fp.POLICIES[model]
        assert registry.get(use_case) is not None, f"{use_case} is not in the AI use-case registry"
        assert column in policy.columns, f"{model}.{column} does not exist"
        assert policy.columns[column] not in fp.NEVER_SENT, f"{use_case} lists {model}.{column}, which is never sent"
        assert cap is None or policy.columns[column] == "T", f"{model}.{column}: only text columns take a cap"
    assert seen


def _canary(column, index):
    kind = type(column.type).__name__.upper()
    if "JSON" in kind:
        return {"canary": f"CANARY_{column.name}", "n": 910000 + index}
    if "DATETIME" in kind:
        return datetime(2031, 5, 17, 3, 4, 5)
    if kind == "DATE":
        return date(2031, 5, 17)
    if "BOOL" in kind:
        return True
    if "INT" in kind:
        return 910000 + index
    if "FLOAT" in kind or "NUMERIC" in kind:
        return 910000.5 + index
    return f"CANARY_{column.name}"


@pytest.mark.parametrize("model", sorted(fp.POLICIES))
def test_nothing_that_is_never_sent_reaches_a_view_whatever_the_record_holds(model):
    """Every column holds a unique canary; a view of any declared use case carries none of the S and D ones."""
    policy = fp.POLICIES[model]
    record = getattr(m, model)()
    for i, column in enumerate(getattr(m, model).__table__.columns):
        setattr(record, column.name, _canary(column, i))
    for use_case, specs in policy.uses.items():
        view = fp.ai_view(record, use_case, book=fp.AliasBook(), now=NOW)
        assert list(view) == [fp._spec(s)[0] for s in specs]                    # exactly what it declared, in order
        sent = json.dumps(view, default=str)
        for i, column in enumerate(getattr(m, model).__table__.columns):
            if policy.columns[column.name] in fp.NEVER_SENT:
                value = _canary(column, i)
                needle = value["canary"] if isinstance(value, dict) else str(value)
                assert needle not in sent, f"{use_case} sent {model}.{column.name}"


def test_a_use_case_that_did_not_declare_a_record_type_cannot_read_it():
    with pytest.raises(KeyError, match="has not declared"):
        fp.ai_view(m.CriticalTask(), "tasks.not_declared")
    with pytest.raises(KeyError, match="no AI field policy"):
        fp.ai_view(object(), "tasks.prioritize")


def test_a_person_column_needs_an_alias_book():
    task = m.CriticalTask(id=1, title="t", assigned_owner_id=7)
    with pytest.raises(ValueError, match="AliasBook"):
        fp.ai_view(task, "tasks.balance_workload")


def test_dates_money_and_addresses_are_reduced_to_what_the_answer_needs():
    assert fp.relative(datetime(2026, 10, 25, 9), NOW) == "in 12 days"
    assert fp.relative(datetime(2026, 5, 26, 23), NOW) == "140 days ago"
    assert fp.relative(date(2026, 10, 13), NOW) == "today" and fp.relative(date(2026, 10, 14), NOW) == "in 1 day"
    assert fp.relative("2026-10-12T08:00:00Z", NOW) == "1 day ago" and fp.relative(None) is None and fp.relative("soon") is None
    assert fp.day(datetime(2026, 10, 25, 9)) == "2026-10-25" and fp.day(None) is None
    assert [fp.band(v) for v in (None, 500, 5_000, 50_000, 250_000, 2_500_000, 25_000_000, 2_500_000_000)] == [
        None, "under 1k", "1k-10k", "10k-100k", "100k-1M", "1M-10M", "10M-100M", "over 100M"]
    assert fp.ip_class("10.1.2.3") == "internal" and fp.ip_class("8.8.8.8") == "public" and fp.ip_class("fe80::1") == "internal"
    assert fp.ip_class("192.168.0.1/24") == "internal" and fp.ip_class("not an ip") is None
    assert fp.ip_class(["10.0.0.1", "8.8.4.4", "10.0.0.2"]) == ["internal", "public"] and fp.ip_class([]) is None


def test_free_text_is_capped_and_a_public_column_keeps_its_shape_but_not_its_length():
    assert fp.text("  hello  ") == "hello" and fp.text("   ") is None and fp.text(None) is None
    assert fp.text("x" * 50, 10) == "x" * 10 + "..."
    assert fp.text(["a", "", "b" * 20], 5) == ["a", "bbbbb..."]
    refs = [f"https://example.test/{i}" + "z" * 400 for i in range(40)]
    out = fp._public({"refs": refs, "n": 3, "deep": {"a": {"b": {"c": {"d": 1}}}}})
    assert len(out["refs"]) == fp.LIST_CAP and all(len(r) == fp.PUBLIC_CAP for r in out["refs"])
    assert out["n"] == 3 and out["deep"] == {"a": {"b": None}}                   # nesting stops three levels down


def test_the_view_applies_each_code(monkeypatch):
    task = m.CriticalTask(id=5, title="Patch the ledger", priority="High", due_date=datetime(2026, 10, 25), assigned_owner_id=7,
                          approval_status="Pending", completed_at=datetime(2026, 10, 1), description="d" * 3000)
    book = fp.AliasBook()
    view = fp.ai_view(task, "tasks.balance_workload", book=book, now=NOW)
    assert view == {"id": 5, "title": "Patch the ledger", "priority": "High", "category": None, "assigned_owner_id": "P1",
                    "due_date": "2026-10-25"}
    assert fp.ai_view(task, "tasks.root_cause", now=NOW)["description"].endswith("...") and \
        len(fp.ai_view(task, "tasks.root_cause", now=NOW)["description"]) == 1503
    incident = m.RiskIncident(id=1, severity="High", incident_date=datetime(2026, 5, 26), financial_impact=2_500_000, tags=["a"])
    monkeypatch.setitem(fp.POLICIES, "RiskIncident", fp.Policy("RiskIncident", fp.POLICIES["RiskIncident"].columns, {
        "erm.incident_analyze": ("id", "severity", "incident_date", "financial_impact", "tags")}))
    assert fp.ai_view(incident, "erm.incident_analyze", now=NOW) == {
        "id": 1, "severity": "High", "incident_date": "140 days ago", "financial_impact": "1M-10M", "tags": ["a"]}
    asset = m.ITAsset(ip_address="10.2.3.4", known_ips=["10.2.3.4", "1.1.1.1"], purchase_date=date(2021, 3, 4))
    monkeypatch.setitem(fp.POLICIES, "ITAsset", fp.Policy("ITAsset", fp.POLICIES["ITAsset"].columns, {
        "x.y": ("ip_address", "known_ips", "purchase_date")}))
    assert fp.ai_view(asset, "x.y", now=NOW) == {"ip_address": "internal", "known_ips": ["internal", "public"], "purchase_date": 2021}


def test_aliases_are_stable_per_person_and_come_back_as_the_person():
    book = fp.AliasBook()
    assert book.alias(7) == "P1" and book.alias(9) == "P2" and book.alias(7) == "P1" and book.alias(None) is None
    assert book.alias("Ali Raza") == "P3" and book.alias("  ali raza ") == "P3"
    assert book.key("P2") == 9 and book.key("P3") == "Ali Raza" and book.key("P9") is None and book.key("nope") is None
    names = {7: "Sara", 9: "Omar", "Ali Raza": "Ali Raza"}
    answer = {"current_workload": {"P1": {"n": 4}, "P10": 1}, "suggestions": [{"from": "P1", "to": "P2", "reason": "P2 has room; P10 unknown"}]}
    out = book.restore(answer, lambda key: names[key])
    assert out == {"current_workload": {"Sara": {"n": 4}, "P10": 1},
                   "suggestions": [{"from": "Sara", "to": "Omar", "reason": "Omar has room; P10 unknown"}]}
    assert fp.AliasBook().restore({"a": "P1"}, str) == {"a": "P1"}                # nothing issued: nothing to restore


def test_rows_a_tenant_defined_itself_are_reduced_to_declared_columns_or_to_cells_that_are_not_about_a_person():
    row = {"name": "Access review", "description": "d" * 900, "owner": "A. Person", "email": "a@b.test", "n": 3, "blank": ""}
    picked = fp.pick(row, ("name", "description", "n"), cap=500)
    assert set(picked) == {"name", "description", "n"} and len(picked["description"]) == 503 and picked["n"] == 3
    labels = {"risk": "Risk description", "own": "Risk Owner", "mail": "Contact e-mail", "ctl": "Key control", "n": "Residual score",
              "by": "Prepared by", "mgr": "Line Manager"}
    cells = fp.free_cells({"risk": "Late settlement", "own": "A. Person", "mail": "a@b.test", "ctl": "Reconciliation", "n": 12,
                           "by": "X", "mgr": "Y", "empty": "  ", "none": None}, labels, cap=500)
    assert cells == [("Risk description", "Late settlement"), ("Key control", "Reconciliation"), ("Residual score", "12")]
    assert len(fp.free_cells({str(i): "v" for i in range(100)}, limit=40)) == 40


# Use cases that touch one of the six record types but do not read a record into the prompt, and why. A new use case that
# does must declare its columns in field_policies.py (or be added here with its reason): the choice is not made in the module.
SIX = {"risk", "incident", "task", "asset", "vulnerability", "assessment"}
NOT_A_RECORD = {
    "erm.risk_suggest": "built from the form the person is filling in",
    "erm.kri_suggest": "built from the form the person is filling in",
    "erm.appetite_suggest": "a risk category only",
    "erm.scenario_explain": "built from the scenario results the person posted",
    "erm.ai_risk_template": "built from the AI-system entry the person is typing",
    "assessments.nca_risk_recommendation": "an NCA entry (its own table), not a register risk",
    "assessments.nca_vuln_recommendation": "an NCA entry (its own table), not a scanner finding",
    "assessments.audit_plan_recommendation": "an audit-plan entry (its own table)",
    "assessments.context": "built from the upload form",
    "assessments.detail_recommendation": "rows of an uploaded sheet, not stored items",
    "evidence.link_picker": "titles of the tenant's records as link candidates; the guard tokenises names",
    "audit.register_risk_suggestions": "risk titles as candidates for a finding; the guard tokenises names",
    "tasks.generate_description": "built from the form the person is filling in",
    "projects.assess_risks": "an IS project and its risks (another record type; no policy yet)",
    "dashboard.ai_insights": "labels and counts only (test_ai_quick_closes)",
    "assets.discovery_explain": "scanner signals about a device that is not yet an asset",
    "assets.import_mapping": "headers and sample cells of an upload (P5 reduces the samples)",
    "assets.layout_plan": "field keys only, never values",
    "vulnerabilities.attack_narrative": "facts from the attack engine's view; the asset is described by type (test_ai_field_policy_calls)",
    "controls_automation.benchmark_select": "an operating-system string",
    "controls_automation.benchmark_classify": "a benchmark's own title",
    "controls_automation.mapping_suggest": "operating-system strings",
    "controls_automation.mapping_suggest_asset": "an operating-system string",
    "controls_automation.normalise_os": "an operating-system string",
    "integrations.control_mapping": "never reaches the model today: it reads attributes the model does not have",
}


def test_every_use_case_that_touches_these_records_declares_its_columns_or_says_why_it_does_not():
    declared = {use_case for _, use_case, _ in fp.declared()}
    undecided = [u.id for u in registry.USE_CASES if SIX & set(u.records) and u.id not in declared and u.id not in NOT_A_RECORD]
    assert not undecided, f"declare what these may read in ai_gateway/field_policies.py, or add them to NOT_A_RECORD: {undecided}"
    assert not [u for u in NOT_A_RECORD if registry.get(u) is None], "an exemption names a use case that is not registered"
    assert not [u for u in NOT_A_RECORD if u in declared], "an exemption for a use case that now declares its columns"
