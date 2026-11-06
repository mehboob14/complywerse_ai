"""Which model a use case runs on.

Every use case belongs to a class in the registry (``light``, ``standard``, ``deep``). The operator names a model for a class
with ``AI_MODEL_LIGHT`` / ``AI_MODEL_DEEP``; ``standard`` is whatever model the platform is configured with. A class with no
model named changes nothing, so this does nothing until it is switched on.

Only a call that asked for the platform's own default model is moved. A call that pins a model on purpose (the regulatory
engine's, a literal in the code) keeps it. When the new model is not a reasoning model, the reasoning settings the call
carried are dropped, since such a model refuses them.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

_ENV = {"light": "AI_MODEL_LIGHT", "deep": "AI_MODEL_DEEP"}
_REASONING = ("gpt-5", "gpt-6", "o1", "o3", "o4")


def _found():
    from ..ai_usage import callsite
    from . import registry

    site = callsite()
    return registry.lookup(site[0], site[1]) if site else []


def tier_of_call() -> str:
    """The class of the calling function. A helper that serves use cases of different classes is ``standard``."""
    tiers = {u.tier for u in _found()}
    return tiers.pop() if len(tiers) == 1 else "standard"


def apply(kwargs: Dict[str, Any]) -> Optional[str]:
    """Swap ``kwargs['model']`` for the class's model when one is named and the call used the default model.
    Returns the class when the model was swapped."""
    if not any(os.environ.get(name, "").strip() for name in _ENV.values()):
        return None
    model = kwargs.get("model")
    if not isinstance(model, str):
        return None
    from ...config import get_openai_model

    if model != get_openai_model():
        return None
    tier = tier_of_call()
    target = os.environ.get(_ENV.get(tier, ""), "").strip()
    if not target or target == model:
        return None
    kwargs["model"] = target
    if not target.lower().startswith(_REASONING):
        kwargs.pop("reasoning_effort", None)
        kwargs.pop("reasoning", None)
    return tier
