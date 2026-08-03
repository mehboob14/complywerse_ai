from .ai_mapping import router as ai_mapping_router
from .groups import router as groups_router
from .inheritance import router as inheritance_router
from .evidence_recs import router as evidence_recs_router
from .gap_analysis import router as gap_analysis_router
from .comparison import router as comparison_router
from .coverage import router as coverage_router
from .reports import router as reports_router

__all__ = ["ai_mapping_router", "groups_router", "inheritance_router", "evidence_recs_router", "gap_analysis_router", "comparison_router", "coverage_router", "reports_router"]
