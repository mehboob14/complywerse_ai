"""Asset discovery module — campaigns, scopes, runs, jobs, observations.

Foundation increment: campaign + scope configuration and run history are live;
scan *execution* (the worker that drains queued jobs and writes observations)
lands in the next increment, and asset *resolution* from observations lands with
the identity sprint. See models/_47_asset_discovery_models.py for the design.
"""
from .router import router as asset_discovery_router

__all__ = ["asset_discovery_router"]
