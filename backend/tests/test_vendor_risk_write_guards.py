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
        if node.name not in TOKEN_AUTHENTICATED and not _guard_calls(node)
    ]
    assert unguarded == [], f"write endpoints with no permission check: {unguarded}"


def test_the_vendor_portal_stays_open_to_the_vendor():
    for file, node in _all_handlers():
        if node.name in TOKEN_AUTHENTICATED:
            assert not _guard_calls(node), (
                f"{file}:{node.name} is the vendor's own endpoint and must not require a "
                "platform permission"
            )


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
