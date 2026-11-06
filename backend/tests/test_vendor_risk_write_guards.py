"""Every third-party-risk write checks a permission, and the vendor portal doesn't.

The TPRA routes were gated from the start; the older vendor, assessment,
questionnaire, monitoring and AI routes beside them were not — 21 write endpoints
that any authenticated user could call, two of which spend the tenant's AI budget.

This is a structural test on purpose: it holds for endpoints nobody has written
yet, which a test per handler would not.
"""
import ast
import pathlib

import pytest

ROUTERS = pathlib.Path(__file__).resolve().parents[1] / "grc" / "modules" / "vendor_risk" / "routers"
MUTATING = {"post", "put", "patch", "delete"}

# The vendor answers a questionnaire without an account: these are authenticated
# by the assessment token itself, and a permission check would lock the vendor out.
TOKEN_AUTHENTICATED = {
    "external_submit_questionnaire",
    "external_upload_evidence",
    "external_delete_evidence",
    "external_import_workbook",     # the offline route: a completed workbook, saved as a draft
}


def _mutating_handlers(path: pathlib.Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            called = decorator.func if isinstance(decorator, ast.Call) else decorator
            if isinstance(called, ast.Attribute) and called.attr in MUTATING:
                yield node
                break


def _guard_calls(node) -> list:
    return [
        sub for sub in ast.walk(node)
        if isinstance(sub, ast.Call)
        and isinstance(sub.func, ast.Attribute)
        and sub.func.attr == "require_write"
    ]


def _is_closed(node) -> bool:
    """A retired endpoint that refuses everyone needs no permission check: it
    answers 410 and points at the store that replaced it."""
    first = node.body[0] if node.body else None
    return (isinstance(first, ast.Raise) and isinstance(first.exc, ast.Call)
            and "410" in ast.unparse(first.exc))


def _all_handlers():
    for path in sorted(ROUTERS.glob("*.py")):
        for node in _mutating_handlers(path):
            yield path.name, node


def test_the_routers_are_where_we_think_they_are():
    names = {p.name for p in ROUTERS.glob("*.py")}
    assert {"vendors.py", "assessments.py", "questionnaires.py", "monitoring.py",
            "lifecycle.py", "ai_analysis.py"} <= names
    assert sum(1 for _ in _all_handlers()) >= 25


def test_every_write_checks_a_permission():
    unguarded = [
        f"{file}:{node.name}" for file, node in _all_handlers()
        if node.name not in TOKEN_AUTHENTICATED
        and not _guard_calls(node) and not _is_closed(node)
    ]
    assert unguarded == [], f"write endpoints with no permission check: {unguarded}"


def test_a_retired_write_refuses_everyone_rather_than_half_working():
    """The JSON remediation writers were replaced by the governed store. A retired
    endpoint must refuse outright — not accept a write nobody reads."""
    closed = [f"{file}:{node.name}" for file, node in _all_handlers() if _is_closed(node)]
    assert {"lifecycle.py:add_remediation", "lifecycle.py:update_remediation",
            "lifecycle.py:delete_remediation"} <= set(closed)
    for file, node in _all_handlers():
        if _is_closed(node):
            assert len(node.body) == 1, f"{file}:{node.name} has unreachable code after its refusal"


def test_the_vendor_portal_stays_open_to_the_vendor():
    for file, node in _all_handlers():
        if node.name in TOKEN_AUTHENTICATED:
            assert not _guard_calls(node), (
                f"{file}:{node.name} is the vendor's own endpoint and must not require a "
                "platform permission"
            )


def test_there_is_one_lifecycle_and_the_old_names_still_resolve():
    """The legacy eight stages were a second lifecycle on a JSON column. They are
    now names that translate into the canonical eleven, which one engine owns."""
    from grc.modules.vendor_risk.routers.lifecycle import CANONICAL_TO_LEGACY, LEGACY_TO_CANONICAL
    from grc.modules.vendor_risk.lifecycle import STAGE_KEYS as LEGACY_KEYS
    from grc.modules.vendor_risk.tpra import stages

    assert set(LEGACY_TO_CANONICAL) == set(LEGACY_KEYS), "every old stage name must still resolve"
    assert set(LEGACY_TO_CANONICAL.values()) <= set(stages.STAGE_KEYS)
    assert set(CANONICAL_TO_LEGACY) == set(stages.STAGE_KEYS), "every canonical stage needs a legacy name"
    assert set(CANONICAL_TO_LEGACY.values()) <= set(LEGACY_KEYS)
    # a round trip out of the old vocabulary and back is stable
    for legacy, canonical in LEGACY_TO_CANONICAL.items():
        assert CANONICAL_TO_LEGACY[canonical] == legacy


def test_the_legacy_advance_endpoint_delegates_to_the_engine():
    """It must not do stage arithmetic of its own: the engine is what enforces
    exit criteria and stops at the gates."""
    path = ROUTERS / "lifecycle.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    handler = next(n for n in ast.walk(tree)
                   if isinstance(n, ast.FunctionDef) and n.name == "advance_stage")
    body = ast.unparse(handler)
    assert "tpra_service.advance_stage" in body
    assert "tpra_service.ensure_active_assessment" in body
    assert "next_stage(current)" not in body, "the old stage arithmetic is gone"


@pytest.mark.parametrize("handler", ["approve_assessment"])
def test_an_approval_cannot_ride_a_generic_risk_edit_grant(handler):
    """Separation of duties: approving needs the approval permission itself, not
    the broad erm:risks:edit fallback every other write accepts."""
    found = False
    for _file, node in _all_handlers():
        if node.name != handler:
            continue
        for call in _guard_calls(node):
            keywords = {kw.arg: kw.value for kw in call.keywords}
            assert "allow_fallback" in keywords, f"{handler} must set allow_fallback"
            assert keywords["allow_fallback"].value is False
            found = True
    assert found, f"{handler} not found among the write handlers"
