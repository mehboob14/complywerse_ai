"""CIS Compliance Plugins module.

Owns the plugin library + per-runner execution + per-tenant scoping. The
``router`` symbol is the FastAPI APIRouter that ``main.py`` mounts at
``/compliance-plugins``.
"""

from .router import router as compliance_plugins_router

__all__ = ["compliance_plugins_router"]
