"""Maker-checker helper: the maker is refused, anyone else and an unknown maker pass."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from grc.services.segregation import ensure_independent


def test_the_maker_cannot_check_their_own_work():
    with pytest.raises(HTTPException) as refused:
        ensure_independent(7, SimpleNamespace(id=7), "approve this assessment")
    assert refused.value.status_code == 409 and "someone else must approve this assessment" in refused.value.detail


def test_someone_else_or_an_unknown_maker_passes():
    ensure_independent(7, SimpleNamespace(id=8))
    ensure_independent(None, SimpleNamespace(id=8))
