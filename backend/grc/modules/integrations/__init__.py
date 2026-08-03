from .router import router as integrations_router
# Track A — Cloud connector framework (Phase 7 foundation). Lives alongside
# the legacy integrations router; its prefix is `/cloud-connectors` so the
# two coexist cleanly.
from .cloud.router import router as cloud_connectors_router

__all__ = ["integrations_router", "cloud_connectors_router"]
