"""Simulated providers — the "mock" used until a tenant has real credentials.

Deterministic (same input → same output), obviously fictitious names and places
(Freedonia, Ruritania, Latveria…), and payload SHAPES that mirror the documented
provider schemas so the same mappers run in simulated and live mode. Every record
produced through a simulated client is stored with ``simulated=True`` and badged
SIMULATED in the UI — it is never evidence of a real screening.

Fixture tokens (case-insensitive, anywhere in the submitted name):
  kestrel / sanctmore   → sanctions hit        pepper     → PEP hit
  lawbreak              → law-enforcement hit  mediaworth → adverse-media hit
  "(ongoing)"           → a NEW match appears on the next ongoing-screening poll
Other names get 0–2 weak/medium noise hits so the resolve workflow is exercisable.
"""
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any, Dict, List, Optional

_FIXTURES = [
    {"token": "kestrel", "ref": "SIM-WC-1001", "name": "Kestrel Maritime Holdings", "entity": "ORGANISATION",
     "categories": ["Sanctions"], "provider": "WATCHLIST", "countries": ["Freedonia"]},
    {"token": "sanctmore", "ref": "SIM-WC-1002", "name": "Ivo Sanctmore", "entity": "INDIVIDUAL",
     "categories": ["Sanctions", "Crime - Financial"], "provider": "WATCHLIST", "countries": ["Ruritania"]},
    {"token": "pepper", "ref": "SIM-WC-1003", "name": "Doralee Pepper", "entity": "INDIVIDUAL",
     "categories": ["PEP"], "provider": "WATCHLIST", "countries": ["Latveria"]},
    {"token": "lawbreak", "ref": "SIM-WC-1004", "name": "Lorne Lawbreak", "entity": "INDIVIDUAL",
     "categories": ["Law Enforcement"], "provider": "WATCHLIST", "countries": ["Genovia"]},
    {"token": "mediaworth", "ref": "SIM-WC-1005", "name": "Mediaworth Logistics", "entity": "ORGANISATION",
     "categories": ["Adverse Media"], "provider": "MEDIA_CHECK", "countries": ["Freedonia"]},
]
_ONGOING_TOKEN = "(ongoing)"


def _h(text: str) -> bytes:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).digest()


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _result(case_id: str, n: int, fixture: dict, submitted: str, strength: str) -> Dict[str, Any]:
    return {
        "resultId": f"{case_id}-r{n}",
        "referenceId": fixture["ref"],
        "matchStrength": strength,
        "matchedTerm": fixture["name"],
        "submittedTerm": submitted,
        "matchedNameType": "PRIMARY",
        "categories": list(fixture["categories"]),
        "providerType": fixture["provider"],
        "countryLinks": [{"country": {"code": c[:3].upper(), "name": c}, "type": "LOCATION"}
                         for c in fixture["countries"]],
        "creationDate": _now_iso(),
        "resolution": None,
        "simulated": True,
    }


class SimulatedWC1Client:
    """Same interface as ``wc1.WC1Client``. State (registered cases, ongoing
    emissions) lives in the connection's ``cache`` so polls behave like a feed."""

    simulated = True

    def __init__(self, conn):
        self._conn = conn

    # state helpers -----------------------------------------------------------
    def _state(self) -> dict:
        return dict((self._conn.cache or {}).get("sim_wc1") or {"cases": {}})

    def _save(self, state: dict) -> None:
        cache = dict(self._conn.cache or {})
        cache["sim_wc1"] = state
        self._conn.cache = cache  # reassign so SQLAlchemy sees the JSON change

    def _results_for(self, case_id: str, case: dict) -> List[dict]:
        name = case["name"]
        low = name.lower()
        results: List[dict] = []
        n = 0
        for fx in _FIXTURES:
            if fx["token"] in low:
                n += 1
                exact = low.replace(_ONGOING_TOKEN, "").strip() == fx["name"].lower()
                results.append(_result(case_id, n, fx, name, "EXACT" if exact else "STRONG"))
        if not results:
            noise = _h(name)[0] % 3
            for i in range(noise):
                fx = {"ref": f"SIM-WC-9{_h(name)[i + 1]:03d}", "name": f"{name.split()[0]} Namesake {i + 1}",
                      "categories": ["Adverse Media"] if i == 0 else ["Other Bodies"],
                      "provider": "WATCHLIST", "countries": ["Ruritania"]}
                n += 1
                results.append(_result(case_id, n, fx, name, "WEAK" if i else "MEDIUM"))
        if case.get("ongoing_emitted"):
            fx = {"ref": "SIM-WC-2001", "name": f"{name.replace(_ONGOING_TOKEN, '').strip()} (new listing)",
                  "categories": ["Sanctions"], "provider": "WATCHLIST", "countries": ["Latveria"]}
            results.append(_result(case_id, 99, fx, name, "STRONG"))
        return results

    # interface ---------------------------------------------------------------
    def test(self) -> dict:
        return {"ok": True, "message": "Simulated World-Check One — no external calls are made."}

    def list_groups(self) -> List[dict]:
        return [{"id": "sim-group-1", "name": "Simulated TPRM screening group", "status": "ACTIVE"}]

    def resolution_toolkit(self, group_id: str) -> dict:
        return {
            "groupId": group_id,
            "resolutionFields": {
                "statuses": [
                    {"id": "sim-st-positive", "label": "Positive", "type": "POSITIVE"},
                    {"id": "sim-st-possible", "label": "Possible", "type": "POSSIBLE"},
                    {"id": "sim-st-false", "label": "False", "type": "FALSE"},
                    {"id": "sim-st-unspecified", "label": "Unspecified", "type": "UNSPECIFIED"},
                ],
                "risks": [
                    {"id": "sim-rk-high", "label": "High", "type": "HIGH"},
                    {"id": "sim-rk-medium", "label": "Medium", "type": "MEDIUM"},
                    {"id": "sim-rk-low", "label": "Low", "type": "LOW"},
                    {"id": "sim-rk-unknown", "label": "Unknown", "type": "UNKNOWN"},
                ],
                "reasons": [
                    {"id": "sim-rs-full", "label": "Full match", "type": ""},
                    {"id": "sim-rs-partial", "label": "Partial match", "type": ""},
                    {"id": "sim-rs-nomatch", "label": "No match", "type": ""},
                    {"id": "sim-rs-unknown", "label": "Unknown", "type": ""},
                ],
            },
        }

    def screen(self, *, group_id: str, entity_type: str, name: str,
               secondary_fields: Optional[List[dict]] = None, case_system_id: Optional[str] = None) -> dict:
        state = self._state()
        cases = dict(state.get("cases") or {})
        case_id = case_system_id or f"sim-case-{_h(entity_type + '|' + name).hex()[:12]}"
        case = dict(cases.get(case_id) or {"name": name, "entity_type": entity_type, "ongoing": False})
        case["name"] = name
        cases[case_id] = case
        state["cases"] = cases
        self._save(state)
        return {"case_system_id": case_id, "results": self._results_for(case_id, case)}

    def get_results(self, case_system_id: str) -> List[dict]:
        case = (self._state().get("cases") or {}).get(case_system_id)
        return self._results_for(case_system_id, case) if case else []

    def resolve(self, case_system_id: str, result_ids: List[str], *, status_id: str,
                risk_id: Optional[str], reason_id: Optional[str], remark: Optional[str]) -> None:
        return None  # accepted; nothing to persist remotely

    def set_ongoing(self, case_system_id: str, enabled: bool) -> None:
        state = self._state()
        cases = dict(state.get("cases") or {})
        if case_system_id in cases:
            case = dict(cases[case_system_id])
            case["ongoing"] = bool(enabled)
            cases[case_system_id] = case
            state["cases"] = cases
            self._save(state)

    def ongoing_updates(self, since_iso: str) -> List[str]:
        state = self._state()
        cases = dict(state.get("cases") or {})
        changed: List[str] = []
        for cid, case in cases.items():
            if case.get("ongoing") and not case.get("ongoing_emitted") and _ONGOING_TOKEN in case["name"].lower():
                case = dict(case)
                case["ongoing_emitted"] = True
                cases[cid] = case
                changed.append(cid)
        state["cases"] = cases
        self._save(state)
        return changed

    def profile(self, reference_id: str) -> dict:
        for fx in _FIXTURES:
            if fx["ref"] == reference_id:
                return {"entityId": reference_id, "names": [{"fullName": fx["name"], "type": "PRIMARY"}],
                        "categories": fx["categories"], "countryLinks": fx["countries"],
                        "details": "Simulated World-Check profile — fictitious record for demos/tests.",
                        "simulated": True}
        return {"entityId": reference_id, "details": "Simulated profile (noise record).", "simulated": True}
