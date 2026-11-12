"""Maker-checker: the person who did a piece of work cannot also approve, verify or sign it off.

Applies to administrators too: a bank's segregation of duties has no administrator exception.
"""
from typing import Optional

from fastapi import HTTPException, status


def ensure_independent(maker_id: Optional[int], user, what: str = "approve this") -> None:
    """Refuse (409) when the acting user is the maker. An unknown maker (None) is not a conflict."""
    if maker_id is not None and user is not None and maker_id == getattr(user, "id", None):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"You did this work, so someone else must {what}.")
