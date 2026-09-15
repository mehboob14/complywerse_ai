"""SCF control-plane module — scope, applicability, registry."""

__all__ = ["scf_router"]


def __getattr__(name: str):
    if name == "scf_router":
        from .router import router as scf_router
        return scf_router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
