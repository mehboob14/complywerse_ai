"""The test plan of a control: every objective it is assessed against, the exact test
for each, and whether that test applies to this organisation.

A control page used to say "Connect a source" and nothing about what would be
tested. The tests are in fact known for every control, from three places:

* the control's SCF assessment objectives (every one of the 1,534 controls has at
  least one) are the things to prove;
* NIST SP 800-53A's own written assessment procedures (public domain) say how:
  what to examine, whom to interview and what to test, for the objectives SCF
  cites one for (about 58%);
* for the rest, a fixed instruction for the objective's PPTDF type
  (`testing_rules.scaffold_procedures`: model-free, because SCF's licence does
  not allow AI to derive text from it).

Automated tests overlay that where a connector check declares it covers the
control or one of its objectives. The check catalog is code, so what could be
automated is listed whether or not the tenant has seeded its connector plugins.

Whether a test applies follows the rules the scope already uses: the control's
own applicability, shared responsibility, a compensating control, and the two
hard gates (no facilities, no personal data) applied to each objective's own
type. Nothing here calls a model.
"""
from __future__ import annotations

from collections import defaultdict
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional, Sequence

from grc.modules.automation.testing_rules import nist_53a, nist_procedures_for_control, scaffold_procedures
from grc.modules.compliance_plugins.runners.covers import covers_for_check
from grc.modules.compliance_plugins.runners.explain import check_title, explain_check
from grc.modules.compliance_plugins.runners.live_api_catalog import PROVIDER_API, provider_checks

_AO_MARKER = "_A"

# What an applicability source means, in words an owner can act on.
_APPLIES_BECAUSE = {
    "derived": "Your in-scope frameworks require it.",
    "baseline": "It is part of the baseline you selected.",
    "override": "Your team marked it applicable.",
    "inherited": "Its parent control is marked applicable.",
}
_NOT_APPLICABLE_BECAUSE = {
    "derived": "None of your in-scope frameworks require it.",
    "override": "Your team marked it not applicable.",
    "inherited": "Its parent control is marked not applicable.",
    "gate": "Your scope rules it out.",
}
_OBLIGATION = {"MCR": "a minimum compliance requirement", "DSR": "a discretionary security requirement"}
_METHODS = ("EXAMINE", "INTERVIEW", "TEST")
_METHOD_LABEL = {"EXAMINE": "Examine", "INTERVIEW": "Interview", "TEST": "Test"}


# ── what the connector catalog says it can automate ─────────────────────────
def _parent(token: str) -> str:
    return token.split(_AO_MARKER, 1)[0] if _AO_MARKER in token else token


@lru_cache(maxsize=1)
def catalog_coverage() -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """{"control": {scf_id: [check]}, "ao": {ao_id: [check]}} from every connector check's `covers`.

    A token naming an objective (`IAC-06_A01`) attaches the check to that objective;
    a bare control id attaches it to the control as a whole.
    """
    out: Dict[str, Dict[str, List[Dict[str, Any]]]] = {"control": defaultdict(list), "ao": defaultdict(list)}
    for provider, spec in PROVIDER_API.items():
        for check in provider_checks(provider):
            tokens = covers_for_check(check)
            if not tokens or not check.get("id"):
                continue
            entry = {
                "provider": provider, "label": spec.get("label", provider), "category": spec.get("category"),
                "id": check["id"], "title": check_title(provider, check["id"]),
                "explain": explain_check(provider, check["id"]),
            }
            for token in tokens:
                bucket = out["ao"] if _AO_MARKER in token else out["control"]
                key = token if _AO_MARKER in token else _parent(token)
                if all(e["id"] != entry["id"] for e in bucket[key]):
                    bucket[key].append(entry)
    return {k: dict(v) for k, v in out.items()}


def _check_state(results: Sequence[Dict[str, Any]]) -> Optional[str]:
    """One word for what a check last found: failing, passing, expired, or None when it has not run."""
    if not results:
        return None
    current = [r for r in results if not r.get("expired")]
    if any(r.get("status") == "fail" for r in current):
        return "failing"
    if any(r.get("status") == "pass" for r in current):
        return "passing"
    if any(r.get("status") == "pass" for r in results):
        return "expired"
    return None


def _automated(entries: Iterable[Dict[str, Any]], connected: set,
               results_by_check: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    return [{**e, "connected": e["provider"] in connected, "state": _check_state(results_by_check.get(e["id"], []))
             if e["provider"] in connected else None} for e in entries]


# ── whether a test applies ──────────────────────────────────────────────────
def control_applicability(state: Optional[Dict[str, Any]], alternative_title: Optional[str] = None) -> Dict[str, Any]:
    """The control-level answer: applies, not_applicable, inherited, alternative or unscoped.

    `state` is the materialised SCFControlState as a dict (or None when the scope has
    not been calculated). Shared responsibility and a compensating control take the
    tests off the organisation's plate; an approved exception does not.
    """
    st = state or {}
    source = st.get("applicability_source")
    obligation = st.get("obligation")
    out: Dict[str, Any] = {
        "state": "unscoped", "reason": "Your scope has not been calculated yet, so applicability is not known.",
        "source": source, "obligation": obligation,
        "obligation_label": _OBLIGATION.get(str(obligation or "").upper()),
        "inheritance": st.get("inheritance_type"), "provider_vendor_id": st.get("provider_vendor_id"),
        "alternative_scf_id": st.get("alternative_scf_id"), "alternative_title": alternative_title,
        "exception": bool(st.get("exception_id")),
    }
    applicable = st.get("is_applicable")
    if applicable is False:
        out["state"] = "not_applicable"
        out["reason"] = st.get("applicability_reason") or _NOT_APPLICABLE_BECAUSE.get(source or "derived", "It does not apply to your scope.")
        return out
    if applicable is True:
        out["state"] = "applies"
        out["reason"] = st.get("applicability_reason") or _APPLIES_BECAUSE.get(source or "derived", "It applies to your scope.")
    if st.get("alternative_scf_id"):
        out["state"] = "alternative"
        out["reason"] = (f"Covered by a compensating control, {st['alternative_scf_id']}"
                         + (f" ({alternative_title})" if alternative_title else "") + ", so its own tests are not run.")
    elif st.get("inheritance_type") == "full":
        out["state"] = "inherited"
        out["reason"] = "Your provider operates this control, so rely on their assurance report instead of testing it yourself."
    elif st.get("inheritance_type") == "shared" and applicable:
        out["reason"] = "Responsibility is shared with your provider: test the part you operate."
    return out


def objective_gate(pptdf: Optional[str], scope: Optional[Dict[str, Any]]) -> Optional[str]:
    """Why an objective of this type cannot apply to the scope, or None. The two hard gates the
    applicability engine applies to a whole control, applied to the objective's own type."""
    kind = (pptdf or "").strip().lower()
    sc = scope or {}
    if kind == "facility" and not sc.get("has_facilities", True):
        return "No owned or leased facilities in scope"
    if kind == "data" and not sc.get("processes_personal_data", True):
        return "Personal data processing is out of scope"
    return None


# ── the plan ────────────────────────────────────────────────────────────────
def _nist_groups(entries: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """NIST's procedures for one objective, one block per NIST control.

    An objective often cites several parts of the same control (`CM-06(01)_ODP[01]`, `[03]`, `[04]`), and the
    methods (what to examine, whom to interview, what to test) belong to the control, so repeating them per
    part showed the same lists three times. The parts are kept as `refs`.
    """
    groups: Dict[str, Dict[str, Any]] = {}
    for e in entries:
        methods = e.get("methods") or {}
        g = groups.setdefault(e["control"], {
            "control": e["control"], "title": e.get("title"), "refs": [],
            "methods": [{"type": m.lower(), "label": _METHOD_LABEL[m], "items": list(methods.get(m) or [])}
                        for m in _METHODS if methods.get(m)],
        })
        g["refs"].append({"ref": e["ref"], "match": e.get("match", "objective"), "objective": e.get("objective")})
    return list(groups.values())


def build_test_plan(
    scf_id: str,
    objectives: Sequence[Dict[str, Any]],
    nist_by_ao: Dict[str, List[Dict[str, Any]]],
    ao_checks: Dict[str, List[Dict[str, Any]]],
    control_checks: Sequence[Dict[str, Any]],
    applicability: Dict[str, Any],
    scope: Optional[Dict[str, Any]],
    connected: set,
    results_by_check: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """The whole plan: one entry per objective, with its exact test and whether it applies."""
    control_na = applicability["state"] in ("not_applicable", "inherited", "alternative")
    tests = []
    for o in objectives:
        gate = None if control_na else objective_gate(o.get("pptdf"), scope)
        nist = _nist_groups(nist_by_ao.get(o["ao_id"], []))
        checks = _automated(ao_checks.get(o["ao_id"], []), connected, results_by_check)
        step = None
        if not nist:
            built = scaffold_procedures([o])
            if built:
                step = {"type": built[0]["procedure_type"], "description": built[0]["description"],
                        "expected": built[0]["expected_result"]}
        tests.append({
            "ao_id": o["ao_id"], "seq": o.get("seq"), "objective": o.get("objective"), "pptdf": o.get("pptdf"),
            "rigor": o.get("rigor"),
            "applies": not control_na and gate is None,
            "not_applicable_reason": applicability["reason"] if control_na else gate,
            "automated": checks, "nist": nist, "standard": step,
        })

    live = [t for t in tests if t["applies"]]
    summary = {
        "total": len(tests), "applies": len(live), "not_applicable": len(tests) - len(live),
        "automated": sum(1 for t in live if t["automated"]),
        "nist": sum(1 for t in live if t["nist"]),
        "standard": sum(1 for t in live if t["standard"]),
    }
    src = nist_53a().get("source") or {}
    return {
        "scf_id": scf_id, "applicability": applicability, "summary": summary, "tests": tests,
        "automated": _automated(control_checks, connected, results_by_check),
        "scope": {"has_facilities": bool((scope or {}).get("has_facilities", True)),
                  "processes_personal_data": bool((scope or {}).get("processes_personal_data", True))},
        "nist_source": {k: src.get(k) for k in ("title", "version", "url", "licence")} if src else None,
    }


def plan_inputs_for(scf_ids: Sequence[str]) -> Dict[str, Any]:
    """The catalog-side inputs for the SCF controls a control is assessed against (one for an SCF
    control, several for a tenant-authored control that implements them)."""
    cov = catalog_coverage()
    nist: Dict[str, List[Dict[str, Any]]] = {}
    ao_checks: Dict[str, List[Dict[str, Any]]] = {}
    control_checks: List[Dict[str, Any]] = []
    for sid in scf_ids:
        nist.update(nist_procedures_for_control(sid))
        control_checks += [c for c in cov["control"].get(sid, []) if all(c["id"] != x["id"] for x in control_checks)]
        for ao_id, entries in cov["ao"].items():
            if _parent(ao_id) == sid:
                ao_checks[ao_id] = entries
    return {"nist_by_ao": nist, "ao_checks": ao_checks, "control_checks": control_checks}
