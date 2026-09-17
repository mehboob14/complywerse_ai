"""The judgement calls in control testing, as pure functions.

Kept out of the router so each rule can be read, argued with and tested on its
own: how many items to test, which ones, what a set of results concludes, and
what a signed-off test may claim about the control.

Licence note: test procedures are scaffolded from SCF assessment objectives by
fixed templates that quote the objective verbatim. No model is involved, which
is what SCF's licence (CC BY-ND, no AI derivatives) allows.
"""
from __future__ import annotations

import json
import random
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

# ── sample size ─────────────────────────────────────────────────────────────
#: How often the control operates -> (lower-risk, key/higher-risk) sample size.
#: The widely used practitioner guidance for tests of controls. A key control,
#: or one with a history of exceptions, takes the upper bound.
SAMPLE_SIZES: Dict[str, Tuple[int, int]] = {
    "annual": (1, 1),
    "semi_annual": (1, 2),
    "quarterly": (2, 2),
    "monthly": (2, 5),
    "weekly": (5, 15),
    "daily": (20, 40),
    "multiple_daily": (25, 60),
    # Event-driven controls (a new joiner, a change ticket) are sized like a
    # frequently operating control; a small population is tested in full below.
    "event": (20, 40),
}
#: An application control that runs identically every time: one instance,
#: provided IT general controls over the system are effective.
AUTOMATED = "automated"

FREQUENCY_LABELS = {
    "annual": "Annually", "semi_annual": "Twice a year", "quarterly": "Quarterly",
    "monthly": "Monthly", "weekly": "Weekly", "daily": "Daily",
    "multiple_daily": "Many times a day", "event": "When triggered (per event)",
    AUTOMATED: "Automated (system enforced)",
}


def recommended_sample_size(frequency: Optional[str], key_control: bool,
                            population_size: Optional[int] = None) -> Tuple[Optional[int], str]:
    """(sample size, the reason in words). None when the frequency is unknown.

    A population no larger than the sample is tested in full — sampling five
    items from a population of three is not a sample.
    """
    if frequency == AUTOMATED:
        n, why = 1, "Automated control: one instance, relying on effective IT general controls."
    elif frequency in SAMPLE_SIZES:
        lo, hi = SAMPLE_SIZES[frequency]
        n = hi if key_control else lo
        label = FREQUENCY_LABELS[frequency].lower()
        why = (f"Operates {label}: {n} item{'s' if n != 1 else ''}"
               + (" (key control, upper bound)." if key_control and lo != hi else "."))
    else:
        return None, "Set how often the control operates to get a recommended sample size."

    if population_size is not None and 0 < population_size <= n:
        return population_size, f"The population ({population_size}) is no larger than the sample, so every item is tested."
    return n, why


# ── selection ───────────────────────────────────────────────────────────────
SELECTION_METHODS = ("random", "systematic", "all", "judgmental")


def select_sample(population: Sequence[str], size: int, method: str,
                  seed: Optional[int] = None) -> List[Optional[str]]:
    """The items to test, in population order.

    `population` is the list of item references when the tester has one, or
    positional placeholders ("Item 1"...) when only a count is known.

    * random — seeded, so re-running the selection with the recorded seed gives
      the same sample: the reproducibility an auditor needs to re-perform it.
    * systematic — every k-th item from a seeded start.
    * all — the whole population.
    * judgmental — nothing preselected; the tester chooses and records why.
      Returned as empty slots to fill.
    """
    items = list(population)
    n = max(0, min(size, len(items))) if method != "judgmental" else max(0, size)
    if method == "all":
        return items
    if method == "judgmental":
        return [None] * n
    if n == 0 or not items:
        return []
    rng = random.Random(seed)
    if method == "systematic":
        step = len(items) / n
        start = rng.random() * step
        picks = sorted({int(start + i * step) for i in range(n)})
        return [items[i] for i in picks]
    return [items[i] for i in sorted(rng.sample(range(len(items)), n))]


def population_items(refs: Optional[Sequence[str]], size: Optional[int]) -> List[str]:
    """The population to select from: the given references, or numbered slots."""
    clean = [r.strip() for r in (refs or []) if r and r.strip()]
    if clean:
        return clean
    return [f"Item {i}" for i in range(1, (size or 0) + 1)]


# ── conclusion ──────────────────────────────────────────────────────────────
def suggested_result(results: Sequence[Optional[str]], tolerable_exceptions: int = 0) -> Optional[str]:
    """The rating the tested items support, before any tester judgement.

    Items not yet tested block a conclusion. `not_applicable` items are out of
    the count. With the default tolerance of zero, one exception is enough to
    call the control ineffective — the tester may conclude otherwise, but has
    to write down why.
    """
    if any(r is None for r in results):
        return None
    tested = [r for r in results if r != "not_applicable"]
    if not tested:
        return None
    exceptions = sum(1 for r in tested if r == "exception")
    if exceptions == 0:
        return "effective"
    if exceptions <= max(0, tolerable_exceptions):
        return "partially_effective"
    return "ineffective"


def count_exceptions(results: Sequence[Optional[str]]) -> Tuple[int, int]:
    """(items tested, exceptions) — not_applicable and untested excluded."""
    tested = [r for r in results if r in ("pass", "exception")]
    return len(tested), sum(1 for r in tested if r == "exception")


# ── what a signed-off test may claim ────────────────────────────────────────
#: CDPAS Standard 6.5 control designations the Assurance page and SoA read.
SATISFACTORY, PARTIAL, DEFICIENT, NOT_ASSESSED = "satisfactory", "partial", "deficient", "not_assessed"


def control_designation(design: Optional[str], operating: Optional[str],
                        independent: bool) -> str:
    """Designation for a control from its latest reviewed design and operating tests.

    * Any ineffective test -> deficient. A failure is a finding whoever reviewed it.
    * Satisfactory needs both tests effective AND independent review. A tester
      signing off their own work completes the test, but is not an assurance
      claim; the control stays not_assessed until someone else reviews it.
    * Anything else that was tested -> partial (partially effective, or design
      effective with operation not yet tested).
    """
    ratings = [r for r in (design, operating) if r]
    if not ratings:
        return NOT_ASSESSED
    if "ineffective" in ratings:
        return DEFICIENT
    if design == "effective" and operating == "effective":
        return SATISFACTORY if independent else NOT_ASSESSED
    return PARTIAL


# ── procedure scaffold from SCF objectives ──────────────────────────────────
_TEMPLATES = {
    # PPTDF tag -> (procedure type, instruction, expected result)
    "Technology": ("inspection",
                   "Inspect the system configuration, or the collector's result where one is connected, to confirm",
                   "The configuration meets the objective for every system in scope."),
    "Process": ("inspection",
                "Inspect the documented process and the records it produces to confirm",
                "Records show the process operating as documented for every item tested."),
    "People": ("inquiry",
               "Interview the people responsible and corroborate their account against records to confirm",
               "Personnel describe the practice consistently, and records corroborate it."),
    "Data": ("inspection",
             "Inspect the data, its classification and handling records to confirm",
             "The data is handled as the objective requires for every item tested."),
    "Facility": ("observation",
                 "Observe the physical safeguard in place and operating to confirm",
                 "The safeguard is observed in place and operating as described."),
}
_DEFAULT_TEMPLATE = ("inspection", "Inspect evidence to confirm",
                     "Evidence shows the objective is met for every item tested.")


def scaffold_procedures(objectives: Sequence[Dict], existing_ao_ids: Sequence[str] = ()) -> List[Dict]:
    """One procedure per assessment objective not already covered.

    The objective is quoted verbatim inside a fixed instruction for its PPTDF
    tag. Deterministic and model-free: SCF's licence does not allow AI to
    generate procedures from its text, and a tester edits the step to fit the
    organisation anyway.
    """
    have = set(existing_ao_ids)
    out = []
    for o in objectives:
        ao_id = o.get("ao_id")
        text = (o.get("objective") or "").strip()
        if not ao_id or not text or ao_id in have:
            continue
        ptype, instruction, expected = _TEMPLATES.get(o.get("pptdf") or "", _DEFAULT_TEMPLATE)
        out.append({
            "ao_ids": [ao_id],
            "procedure_type": ptype,
            "description": f"{instruction}: “{text}”",
            "expected_result": expected,
        })
    return out


# ── NIST SP 800-53A procedures behind SCF objectives ────────────────────────
_NIST_53A = Path(__file__).resolve().parents[2] / "seed_data" / "nist" / "sp800_53a.json"


@lru_cache(maxsize=1)
def nist_53a() -> Dict:
    """The trimmed NIST SP 800-53A seed (tools/build_nist_53a). Empty if absent."""
    try:
        return json.loads(_NIST_53A.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — optional seed
        return {}


def nist_procedures_for_control(scf_id: str, data: Optional[Dict] = None) -> Dict[str, List[Dict]]:
    """SCF objective id -> the NIST SP 800-53A procedures its origin cites.

    Each entry names the 800-53A reference SCF cited, the objective statement
    when NIST has one, and what to EXAMINE, whom to INTERVIEW and what to TEST
    for the control that reference belongs to. NIST text is public domain, so
    unlike SCF's it can be shown and built on freely.
    """
    data = nist_53a() if data is None else data
    controls = data.get("controls") or {}
    objectives = data.get("objectives") or {}
    prefix = f"{scf_id}_"
    out: Dict[str, List[Dict]] = {}
    for ao_id, refs in (data.get("by_ao") or {}).items():
        if not ao_id.startswith(prefix):
            continue
        entries = []
        for ref in refs:
            control = controls.get(ref["control"])
            if not control:
                continue
            entries.append({
                "ref": ref["ref"],
                "control": ref["control"],
                "title": control.get("title", ""),
                "match": ref.get("match", "objective"),
                "objective": (objectives.get(ref["ref"]) or {}).get("text"),
                "methods": control.get("methods") or {},
            })
        if entries:
            out[ao_id] = entries
    return out
