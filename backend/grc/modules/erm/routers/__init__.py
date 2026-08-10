from .risks import router as risks_router
from .kris import router as kris_router
from .incidents import router as incidents_router
from .incident_import import router as incident_import_router
from .incident_links import router as incident_links_router
from .reviews import router as reviews_router
from .dependencies import router as dependencies_router
from .reports import router as reports_router
from .mitigation_actions import router as mitigation_actions_router
from .mitigation_actions import risk_actions_router
from .scales import router as scales_router
from .appetite import router as appetite_router
from .internal_controls import router as internal_controls_router
from .rcsa import router as rcsa_router
from .rcsa_custom import router as rcsa_custom_router
from .risk_assessments import router as risk_assessments_router
from .framework_risk_assessments import router as framework_risk_assessments_router
from .advanced_analytics import router as advanced_analytics_router
from .dashboard import router as sections_dashboard_router
from .onboarding import router as onboarding_router
from .kris_workflow import router as kris_workflow_router
from .quantification import router as quantification_router

__all__ = [
    "quantification_router",
    "sections_dashboard_router",
    "onboarding_router",
    "kris_workflow_router",
    "risks_router",
    "kris_router",
    "incidents_router",
    "incident_import_router",
    "incident_links_router",
    "reviews_router",
    "dependencies_router",
    "reports_router",
    "mitigation_actions_router",
    "risk_actions_router",
    "scales_router",
    "appetite_router",
    "internal_controls_router",
    "rcsa_router",
    "rcsa_custom_router",
    "risk_assessments_router",
    "framework_risk_assessments_router",
    "advanced_analytics_router"
]
