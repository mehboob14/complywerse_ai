"""Self-check for the one non-trivial branch in the native Help Desk ticket
core: is_valid_status_transition (logic spec §3.1). Pure function, no DB."""
import os
from types import SimpleNamespace

os.environ.setdefault("SESSION_SECRET", "test")

from grc.modules.helpdesk_native.tickets import is_valid_status_transition


def _s(sid, cat):
    return SimpleNamespace(id=sid, category=cat)


def test_transition_gate():
    open_ = _s(1, "Open")
    resolved = _s(2, "Resolved")
    closed = _s(3, "Resolved")  # Closed is also Resolved-category

    # new doc / no old status -> not a transition
    assert is_valid_status_transition(None, open_) is False
    # unchanged -> not a transition
    assert is_valid_status_transition(open_, open_) is False
    # Open -> Resolved -> valid (stamps resolution)
    assert is_valid_status_transition(open_, resolved) is True
    # Resolved -> Closed (both Resolved category) -> NOT valid (preserve stamps)
    assert is_valid_status_transition(resolved, closed) is False
    # reopen Resolved -> Open -> valid
    assert is_valid_status_transition(resolved, open_) is True


if __name__ == "__main__":
    test_transition_gate()
    print("OK")
