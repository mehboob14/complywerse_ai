"""What the Assurance tab says about a required artifact.

The tab turns linked files and automated results into one word per artifact —
satisfied, pending review, failing, stale, missing — and a readiness count. An
assessor reads those words as findings, so the cases that matter are the ones
where a plausible rule would overstate assurance: an expired approval counted
as proof, a collector that could not run counted as a failing control, or an
automated result standing in for the manual half of a hybrid artifact.

DB-free: the state rules are pure functions.
"""
from grc.modules.automation.assurance import artifact_state, automated_state, evidence_state


# ── one linked file ─────────────────────────────────────────────────────────
def test_expiry_outranks_approval():
    """An approved policy past its validity date proves nothing today."""
    assert evidence_state("approved", expired=True, is_stale=False) == "stale"
    assert evidence_state("approved", expired=False, is_stale=True) == "stale"


def test_unreviewed_files_are_pending_not_proof():
    for status in ("draft", "pending_review", None, ""):
        assert evidence_state(status, expired=False, is_stale=False) == "pending"


def test_rejected_is_its_own_state():
    assert evidence_state("rejected", expired=False, is_stale=False) == "rejected"


# ── automated results for the control ───────────────────────────────────────
def test_a_current_failure_outranks_passes():
    results = [{"status": "pass", "expired": False}, {"status": "fail", "expired": False}]
    assert automated_state(results) == "failing"


def test_a_collector_that_could_not_look_is_not_a_failing_control():
    assert automated_state([{"status": "error", "expired": False}]) == "none"
    assert automated_state([{"status": "not_run", "expired": False}]) == "none"


def test_old_results_expire_rather_than_pass():
    assert automated_state([{"status": "pass", "expired": True}]) == "expired"
    assert automated_state([]) == "none"


def test_an_expired_failure_does_not_mask_a_current_pass():
    results = [{"status": "fail", "expired": True}, {"status": "pass", "expired": False}]
    assert automated_state(results) == "passing"


# ── the artifact ────────────────────────────────────────────────────────────
def test_manual_artifacts_need_a_persons_evidence():
    assert artifact_state("manual", [], "passing") == "missing"
    assert artifact_state("manual", ["approved"], "none") == "satisfied"
    assert artifact_state("manual", ["pending"], "none") == "pending_review"
    assert artifact_state("manual", ["stale"], "none") == "stale"
    assert artifact_state("manual", ["rejected"], "none") == "missing"


def test_best_file_wins_when_several_are_linked():
    assert artifact_state("manual", ["stale", "approved"], "none") == "satisfied"
    assert artifact_state("manual", ["rejected", "pending"], "none") == "pending_review"


def test_hybrid_artifacts_still_need_the_manual_half():
    """A passing collector covers the automated part only."""
    assert artifact_state("hybrid", [], "passing") == "missing"
    assert artifact_state("hybrid", ["approved"], "failing") == "satisfied"


def test_automated_artifacts_are_satisfied_by_current_results():
    assert artifact_state("automated", [], "passing") == "satisfied"
    assert artifact_state("automated", [], "failing") == "failing"
    assert artifact_state("automated", [], "expired") == "stale"
    assert artifact_state("automated", [], "none") == "missing"


def test_an_uploaded_file_stands_in_until_a_collector_is_connected():
    assert artifact_state("automated", ["approved"], "none") == "satisfied"
    assert artifact_state("automated", ["pending"], "none") == "pending_review"


def test_no_upload_hides_a_failing_collector():
    """The collector is looking at the system now; an uploaded export is a
    snapshot. Not even an approved file may paper over a live failure."""
    assert artifact_state("automated", ["pending"], "failing") == "failing"
    assert artifact_state("automated", ["approved"], "failing") == "failing"


# ── the in-scope view ───────────────────────────────────────────────────────
def test_in_scope_view_shows_only_scoped_frameworks_and_fills_gaps_from_scf():
    from grc.modules.automation.router import _in_scope_requirements, in_scope_artifacts
    ours = {"pci_dss": [{"code": "6.3.2", "name": "6.3.2"}], "iso_27001": [{"code": "A.5.9", "name": "A.5.9"}]}
    published = {"pci_dss": ["6.3.2", "A2.1"], "pisf_2026": ["3.1"]}
    assert _in_scope_requirements(ours, published, ["pci_dss", "pisf_2026"]) == {
        "pci_dss": [{"code": "6.3.2", "name": "6.3.2"}, {"code": "A2.1", "name": "A2.1"}],
        "pisf_2026": [{"code": "3.1", "name": "3.1"}],
    }
    assert _in_scope_requirements(ours, None, []) is ours  # nothing scoped: every framework
    arts = in_scope_artifacts([{"name": "Policy", "required_by": ["ISO 27001", "PCI DSS"]},
                               {"name": "Board minutes", "required_by": ["NIS2"]}],
                              [{"key": "pci_dss", "label": "PCI DSS"}])
    assert arts == [{"name": "Policy", "required_by": ["PCI DSS"]}]  # the NIS2-only ask is dropped


def test_scoped_evidence_is_each_frameworks_own_asks_named_once(monkeypatch):
    from grc.modules.automation import router
    index = {
        "pci_dss": {
            "6.3.2": [{"name": "Software Component Inventory (SBOM)", "description": "SBOM", "filetype": "XLSX"},
                      {"name": "Inventory Maintenance Procedure", "description": "", "filetype": "PDF"}],
            "11.2.2": [{"name": "Inventory maintenance procedure", "description": "", "filetype": "PDF"},
                       {"name": "Wireless scan export", "description": "", "filetype": "JSON"}],
        },
        "iso_27001": {"A.5.9": [{"name": "Asset register", "description": "", "filetype": "XLSX"}]},
    }
    monkeypatch.setattr(router, "_framework_evidence_index", lambda: index)
    scope = [{"key": "pci_dss", "label": "PCI DSS"}]
    got = router.scoped_required_evidence({"pci_dss": ["11.2.2", "6.3.2"], "iso_27001": ["A.5.9"]}, scope, automated=True)
    assert [g["name"] for g in got] == [  # codes in reading order; ISO out of scope
        "Software Component Inventory (SBOM)", "Inventory Maintenance Procedure", "Wireless scan export"]
    assert got[1]["references"] == ["PCI DSS 6.3.2", "PCI DSS 11.2.2"]  # one row for the repeated ask
    assert [g["collection_method"] for g in got] == ["manual", "manual", "automated"]
    assert [g["type"] for g in got] == ["register", "procedure", "configuration"]
    manual_only = router.scoped_required_evidence({"pci_dss": ["11.2.2"]}, scope, automated=False)
    assert {g["collection_method"] for g in manual_only} == {"manual"}  # no collector, nothing automated


def test_evidence_type_reads_the_name_before_the_file_type():
    from grc.modules.automation.router import evidence_type
    assert evidence_type("Log Review Procedure", "PDF") == "procedure"
    assert evidence_type("Firewall ruleset export", "JSON") == "configuration"
    assert evidence_type("Supplier attestation letter", "PDF") == "record"  # not a test
    assert evidence_type("Something else", "LOG") == "log"
    assert evidence_type("Something else", None) == "document"
