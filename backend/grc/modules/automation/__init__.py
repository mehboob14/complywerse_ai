"""Automation module — SOC 2 quantitative controls + AWS automated checks,
plus framework-aware control libraries (SOC 2 / ISO 27001 / GDPR)."""

from .router import router as automation_soc2_router
from .router import lib_router as automation_frameworks_router
from .router import common_router as automation_common_router

__all__ = ["automation_soc2_router", "automation_frameworks_router", "automation_common_router"]
