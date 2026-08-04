"""Static audit: scorecard + TPRM API routes registered and frontend paths aligned.

Usage (from backend/):  PYTHONPATH=. python scripts/audit_dashboard_wiring.py
"""
from __future__ import annotations

from grc.main import app
from grc.services.scorecard_config import DEFAULTS

# Routes are registered without the /grc reverse-proxy prefix on the app object.
SCORECARD_ENDPOINTS = {
    "governance": "/governance/dashboard/documents-overview",
    "compliance": "/compliance/policies/dashboard/sections-overview",
    "assessments": "/compliance/assessments/overview",
    "kpi_live": "/compliance/assessments/kpi-live",
    "assets": "/assets/inventory-overview",
    "issues": "/issue-management/dashboard/sections-overview",
    "assurance": "/control-library/assurance/sections-overview",
    "erm": "/erm/dashboard/sections-overview",
}

TPRM_ENDPOINTS = {
    "program_dashboard": "/vendor-risk/tpra/dashboard",
    "lifecycle_board": "/vendor-risk/tpra/board",
    "findings_register": "/vendor-risk/tpra/findings-register",
    "monitoring_feed": "/vendor-risk/tpra/monitoring-feed",
    "risk_register": "/vendor-risk/tpra/risk-register",
    "risk_trend": "/vendor-risk/tpra/risk-trend",
    "legacy_vendor_dashboard": "/vendor-risk/vendors/dashboard",
    "bcm_dashboard": "/bcm/dashboard",
}

FRONTEND_PAGES = [
    "/vendor-risk",
    "/vendor-risk/vendors",
    "/vendor-risk/assessments",
    "/vendor-risk/findings",
    "/vendor-risk/monitoring",
    "/vendor-risk/questionnaires",
    "/vendor-risk/risk-360",
    "/vendor-risk/exchange",
    "/vendor-risk/settings",
    "/governance",
    "/compliance",
    "/assets",
    "/issues",
    "/control-library/assurance",
    "/erm",
    "/bcm",
]


def _has_route(paths: set[str], target: str) -> bool:
    return target in paths or any(p.startswith(target + "/") for p in paths)


def main() -> int:
    paths = {getattr(r, "path", "") for r in app.routes if hasattr(r, "path")}
    failed = 0

    print("=== Scorecard API routes ===")
    for name, path in SCORECARD_ENDPOINTS.items():
        ok = _has_route(paths, path)
        print(f"{'OK' if ok else 'FAIL'}  {name}: {path}")
        failed += 0 if ok else 1

    print("\n=== TPRM API routes ===")
    for name, path in TPRM_ENDPOINTS.items():
        ok = _has_route(paths, path)
        print(f"{'OK' if ok else 'FAIL'}  {name}: {path}")
        failed += 0 if ok else 1

    print("\n=== Scorecard config modules (backend DEFAULTS) ===")
    for mod, cfg in DEFAULTS.items():
        n = len(cfg.get("sections", []))
        print(f"  {mod}: {n} weighted sections")

    print("\n=== KPI live metric keys (empty DB smoke) ===")
    from grc.modules.assessments.kpi_live import compute_kpi_metrics

    class _Q:
        def filter(self, *a, **k):
            return self

        def all(self):
            return []

    class _DB:
        def query(self, *a, **k):
            return _Q()

    keys = list(compute_kpi_metrics(_DB(), tenant_ids=[1]).keys())
    print("  " + ", ".join(keys) if keys else "  (none without tenant data)")

    print("\n=== Frontend pages (file existence check) ===")
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[2] / "grc-frontend" / "src" / "app" / "(dashboard)"
    for route in FRONTEND_PAGES:
        rel = route.strip("/")
        page = root / rel / "page.tsx"
        ok = page.is_file() or (root / rel).is_file()
        print(f"{'OK' if ok else 'WARN'}  {route}")

    print(f"\n=== Summary: {failed} missing API route(s) ===")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
