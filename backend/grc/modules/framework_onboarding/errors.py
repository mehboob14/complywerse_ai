"""The one refusal framework onboarding raises: it carries its HTTP status and the body to show (a person-readable message, optionally the unmet checks)."""
from __future__ import annotations

from typing import Any


class OnboardingError(Exception):
    def __init__(self, status: int, message: str, **more: Any):
        super().__init__(message)
        self.status, self.body = status, {"message": message, **more}
