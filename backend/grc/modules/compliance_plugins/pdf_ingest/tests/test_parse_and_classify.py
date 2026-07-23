"""Unit tests for the CIS PDF ingest parser + classifier.

Mirrors the regression that prompted task #69: a Visual Studio Code GPO
benchmark whose TOC was being treated as a rule list, every flagged rule
mis-tagged as `linux_ssh`, and confidence stuck at 0% because the section
splitter never matched. The fixture below is a hand-crafted CIS-shaped
text snippet that exercises:

  * dot-leader TOC entries → must be rejected
  * trailing-page-number TOC entries → must be rejected
  * a real rule heading ("1.1.1 Ensure 'ChatMCP' is set to 'Disabled'")
    → must be kept, classified as ``windows_winrm`` (because the
    benchmark slug contains "VISUAL_STUDIO_CODE"), and have a non-zero
    confidence score (≥ 0.5 — Description + Rationale + Audit + Remediation
    are all present).

Run with:  ``pytest .migration-backup/backend/grc/modules/compliance_plugins/pdf_ingest/tests``
"""
from __future__ import annotations

from grc.modules.compliance_plugins.pdf_ingest.classify import (
    runner_type_for,
    runner_type_from_benchmark,
)
from grc.modules.compliance_plugins.pdf_ingest.parse_fields import (
    assemble_plugin_fields,
)
from grc.modules.compliance_plugins.pdf_ingest.parse_rules import (
    split_into_rules_with_log,
)


# A trimmed-down VS Code GPO benchmark — keeps the exact shapes the v1.0.0
# PDF used (dot-leaders in the TOC, "Description:" labels with the body on
# the next line, "(Automated)" suffix on the rule title).
VSCODE_FIXTURE = """\
Table of Contents
Overview ...................................................................................................................... 5
1 Application Settings ............................................................................................. 12
1.1 Workbench .......................................................................................................... 12
1.1.1 Ensure 'ChatMCP' is set to 'Disabled' (Automated) ........................................ 13
2 Telemetry .................................................................................................................. 47

1 Application Settings
1.1 Workbench
1.1.1 Ensure 'ChatMCP' is set to 'Disabled' (Automated)
Profile Applicability:
- Level 1

Description:
The ChatMCP integration permits Visual Studio Code to call out to remote
Model Context Protocol servers. Disabling it prevents data exfiltration
through unsanctioned model providers.

Rationale:
Allowing arbitrary MCP endpoints means workspace contents can be
transmitted to third-party services without explicit user consent.

Audit:
Open the Group Policy Editor (gpedit.msc) and confirm the registry value
HKLM\\Software\\Policies\\Microsoft\\VisualStudioCode\\ChatMCP is set to 0.

Remediation:
Set the policy "Disable ChatMCP" to Enabled via gpedit.msc, then run
gpupdate /force.

Default Value: Enabled

References:
1. https://code.visualstudio.com/docs/policies

CIS Controls:
Controls Version 8
4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software

2 Telemetry
"""


BENCHMARK_LABEL = "CIS_VISUAL_STUDIO_CODE_GPO_v1.0.0"


def test_benchmark_classifier_pins_windows_for_vscode_gpo():
    assert runner_type_from_benchmark(BENCHMARK_LABEL) == "windows_winrm"
    # Audit text mentions registry/gpedit — also windows-flavoured.
    assert runner_type_for(BENCHMARK_LABEL, "open gpedit.msc") == "windows_winrm"
    # When the benchmark name pins Windows, even a shell-flavoured Audit
    # text must NOT downgrade the runner type to linux_ssh.
    assert runner_type_for(BENCHMARK_LABEL, "grep something /etc/foo") == "windows_winrm"


def test_benchmark_classifier_returns_none_for_unknown_benchmark():
    # Generic CIS template name with no platform marker — caller must fall
    # through to audit-text classification.
    assert runner_type_from_benchmark("CIS_CUSTOM_TEMPLATE_v1") is None


def test_split_into_rules_filters_toc_entries():
    rules, rejected = split_into_rules_with_log(VSCODE_FIXTURE)
    # Exactly one real rule survives: 1.1.1.
    assert len(rules) == 1, f"expected 1 rule, got {len(rules)}: {[r['rule_id'] for r in rules]}"
    rule = rules[0]
    assert rule["rule_id"] == "1.1.1"
    assert "ChatMCP" in rule["title"]
    # The four TOC dot-leader rows (Overview, 1, 1.1, 1.1.1, 2) plus the
    # bare numeric headers ("1 Application Settings", "1.1 Workbench",
    # "2 Telemetry") get rejected — we just assert at least one was caught
    # so the surfaced "TOC rejected" counter is non-zero.
    assert sum(rejected.values()) > 0, f"expected TOC rejections, got {rejected!r}"
    assert (
        "toc_dot_leader" in rejected
        or "section_header_no_verb" in rejected
        or "no_body" in rejected
    ), rejected


def test_assemble_plugin_fields_classifies_and_scores_vscode_rule():
    rules, _ = split_into_rules_with_log(VSCODE_FIXTURE)
    assert rules, "fixture must yield at least one rule"
    fields = assemble_plugin_fields(rules[0], benchmark=BENCHMARK_LABEL)
    # Platform is forced to windows_winrm by the benchmark slug, NOT
    # silently defaulted to linux_ssh as in the bug report.
    assert fields["runner_type"] == "windows_winrm", fields
    # All four sections are present in the fixture, so confidence must be
    # the maximum (1.0) — at minimum strictly greater than zero, which is
    # what the bug screenshot showed.
    assert fields["confidence_score"] >= 0.5, fields
    # And the description/rationale/audit/remediation actually populated.
    assert "ChatMCP" in (fields.get("description") or "")
    assert "Group Policy" in (fields.get("audit_steps_text") or "")
    assert "gpupdate" in (fields.get("remediation") or "")


def test_cis_controls_cross_references_rejected():
    """Rule 1.1.1 has a "CIS Controls" section listing v8 control 12.5.

    The bare numeric prefix regex would happily catch "12.5 Centralize
    Network Authentication, Authorization, and Auditing (AAA)" as if it
    were a benchmark rule. The new no_canonical_sections gate must drop
    it because the body has no Description: / Audit: / Remediation: etc.
    """
    text = (
        "1.1.1 Ensure password length is 14 (Automated)\n"
        "Profile Applicability:\n"
        "- Level 1\n"
        "Description:\n"
        "Long passwords are harder to brute-force and remain a baseline\n"
        "control for any account-protection strategy.\n"
        "Audit:\n"
        "Run: net accounts | grep 'Minimum password length'\n"
        "Remediation:\n"
        "Run: net accounts /minpwlen:14\n"
        "CIS Controls:\n"
        "Controls Version 8\n"
        "12.5 Centralize Network Authentication, Authorization, and Auditing (AAA)\n"
        "Use a single AAA system to centralize network authentication.\n"
        "13.2 Deploy a Host-Based Intrusion Detection Solution\n"
        "Detect and alert on suspicious activity at the host level.\n"
    )
    rules, rejected = split_into_rules_with_log(text)
    rule_ids = [r["rule_id"] for r in rules]
    assert rule_ids == ["1.1.1"], (
        f"only 1.1.1 should survive; the 12.5/13.2 cross-references must be "
        f"rejected because they have no canonical sections. Got: {rule_ids}"
    )
    # Either rejection reason is acceptable: cross-references with a
    # one-line gloss get their gloss eaten by title-recovery and then
    # fail the no_body gate; cross-references with no gloss at all fail
    # no_canonical_sections directly.
    rejected_total = rejected.get("no_canonical_sections", 0) + rejected.get("no_body", 0)
    assert rejected_total >= 2, rejected


def test_saas_benchmarks_classified_manual():
    """GitHub / Microsoft 365 / Okta benchmarks must NOT default to linux_ssh.

    These products have no shell or SSH surface — there's nothing for the
    Linux runner to do. Tagging them `manual` keeps reviewers from
    silently scheduling no-op checks under the wrong runner.
    """
    assert runner_type_from_benchmark("CIS_GITHUB_v1.2.0") == "manual"
    assert runner_type_from_benchmark("CIS_GITLAB_v1.0.0") == "manual"
    assert runner_type_from_benchmark("CIS_MICROSOFT_365_FOUNDATIONS_v3.0.0") == "manual"
    assert runner_type_from_benchmark("CIS_OFFICE_365_v3.0.0") == "manual"
    assert runner_type_from_benchmark("CIS_OKTA_v1.0.0") == "manual"
    # Audit text mentions linux-ish commands? Doesn't matter — benchmark
    # name pins the runner.
    assert runner_type_for("CIS_GITHUB_v1.2.0", "grep something /etc/foo") == "manual"


def test_truncated_table_cell_titles_recovered():
    """CIS GitHub renders titles like:

        1.1.10 Ensure open Git branches are up to date before they can ○ ○
        be merged into code base (Manual)
        Description:
        ...

    The ○ ○ glyphs are "Set Correctly: Yes / No" cells. The recovery
    pass must strip the glyphs and glue "be merged into code base
    (Manual)" back onto the title.
    """
    text = (
        "1.1.10 Ensure open Git branches are up to date before they can o o\n"
        "be merged into code base (Manual)\n"
        "Description:\n"
        "Open branches that have fallen behind main accumulate merge\n"
        "conflicts and obscure the audit trail of approved changes.\n"
        "Audit:\n"
        "Inspect each open PR and confirm it is up-to-date with the base\n"
        "branch via the GitHub UI or REST API.\n"
        "Remediation:\n"
        "Enable 'Require branches to be up to date before merging' on the\n"
        "branch protection rule.\n"
    )
    rules, _ = split_into_rules_with_log(text)
    assert len(rules) == 1, [r["rule_id"] for r in rules]
    title = rules[0]["title"]
    # Glyphs gone
    assert " o o" not in title and "○" not in title, title
    # Wrapped fragment glued back on
    assert "be merged into code base" in title, title
    assert "(Manual)" in title, title


def test_quoted_value_only_titles_rejected():
    # A heading that is just ``2.1 'Disabled'`` is a CIS settings-table row,
    # not a rule.
    text = (
        "2.1 'Disabled'\n"
        "3.1 Ensure foo is configured (Automated)\n"
        "Description:\n"
        "Foo must be configured to mitigate unauthorised access to the\n"
        "underlying resource via the default permissive policy.\n"
        "Audit:\n"
        "Run grep '^Foo' /etc/foo.conf and verify the line is present.\n"
    )
    rules, rejected = split_into_rules_with_log(text)
    assert [r["rule_id"] for r in rules] == ["3.1"], rules
    assert rejected.get("quoted_value_only", 0) >= 1
