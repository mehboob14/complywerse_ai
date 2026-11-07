"""Risk Posture EASM weights: a tenant's four tuned percentages are used only when all four
are set; otherwise the fixed defaults (so untuned tenants score exactly as before)."""
from types import SimpleNamespace

from grc.modules.risk_posture.service import DEFAULT_EASM_WEIGHTS, resolve_easm_weights_for_tenant


class _FakeSession:
    def __init__(self, row):
        self.row = row

    def query(self, *_a, **_k):
        return self

    def filter(self, *_a, **_k):
        return self

    def first(self):
        return self.row


def _row(h, e, x, b):
    return SimpleNamespace(weight_easm_hygiene=h, weight_easm_exploit=e, weight_easm_exposure=x, weight_easm_business=b)


def test_defaults_without_a_row_or_a_session():
    assert resolve_easm_weights_for_tenant(_FakeSession(None), 1) == DEFAULT_EASM_WEIGHTS
    assert resolve_easm_weights_for_tenant(None, 1) == DEFAULT_EASM_WEIGHTS
    assert abs(sum(DEFAULT_EASM_WEIGHTS.values()) - 1.0) < 1e-9


def test_tuned_percentages_become_fractions():
    w = resolve_easm_weights_for_tenant(_FakeSession(_row(10, 60, 20, 10)), 1)
    assert w == {"hygiene": 0.10, "exploitability": 0.60, "exposure": 0.20, "business": 0.10}


def test_a_partial_set_falls_back_to_the_defaults():
    assert resolve_easm_weights_for_tenant(_FakeSession(_row(10, None, 20, 10)), 1) == DEFAULT_EASM_WEIGHTS
