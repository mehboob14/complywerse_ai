"""The one error the data-protection guard raises. It has no imports so the shim in grc/config.py can load it first."""
from __future__ import annotations

from typing import Optional


class AIBlocked(RuntimeError):
    """A prompt was not sent to a model because a data-protection rule refused it.

    ``str(exc)`` is written for a person (no model or vendor name), ``code`` is stable (``vision_blocked``,
    ``restricted_data``, ``secret_survived``, ``stream_unsupported``, ``gateway_error`` ...), ``rule`` names the rule
    that fired and ``report`` is the guard's metadata for the call (counts only, never a value).
    """

    def __init__(self, code: str, message: str, *, rule: str = "", use_case: Optional[str] = None,
                 report: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.rule = rule
        self.use_case = use_case
        self.report = report
