from .downloads import router as agent_downloads_router
from .router import router as agents_router

__all__ = ["agents_router", "agent_downloads_router"]
