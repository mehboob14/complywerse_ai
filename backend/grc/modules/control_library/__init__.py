from fastapi import APIRouter
from .routers import ai_mapping_router, groups_router, inheritance_router, evidence_recs_router, gap_analysis_router, comparison_router, coverage_router, reports_router, workbench_router, assurance_router

control_library_router = APIRouter(prefix="/control-library", tags=["Control Library"])

control_library_router.include_router(ai_mapping_router)
control_library_router.include_router(groups_router)
control_library_router.include_router(inheritance_router)
control_library_router.include_router(evidence_recs_router)
control_library_router.include_router(gap_analysis_router)
control_library_router.include_router(comparison_router)
control_library_router.include_router(coverage_router)
control_library_router.include_router(reports_router)
control_library_router.include_router(workbench_router)
control_library_router.include_router(assurance_router)

__all__ = ["control_library_router"]
