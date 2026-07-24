"""Layer 3 — reachability assessment. Per technique, per (vuln x asset).

Takes the techniques Layer 2 selected and decides, for one vulnerability on one
specific asset, whether each is BLOCKED / POSSIBLE / LIKELY — and the plain
"Why?" behind the badge. This is the layer that makes the chain honest: Layer 2
says "this technique applies to this bug"; Layer 3 says "…but on THIS asset the
attacker can't reach it, because it isn't internet-exposed."

The whole engine is the reference's tiny function:

    for precondition in technique.hard_preconditions:
        if precondition fails -> BLOCKED, and its own message IS the "Why?"
    if a confirmation signal holds -> LIKELY
    else -> POSSIBLE

Two design choices worth stating out loud:

* **BLOCKED needs a definite disqualifying fact, never a missing one.** A
  precondition blocks only when a signal is *known* to disqualify the technique
  (internet_exposed is False), not when it's unknown (None). We never claim a
  path is closed just because we lack data — that would be a comforting lie.
* **Control coverage does NOT change a badge.** It's carried as an informational
  signal only. A control being *mapped* to this asset is not evidence it's
  *effective*, and letting "we have a control" downgrade LIKELY -> POSSIBLE
  would repeat exactly the existence-vs-effectiveness flaw the scorecard audit
  found. Coverage informs the evidence panel; it does not soften the verdict.

Pure and DB-free. ``build_signals`` reads a vuln + asset with defensive
``getattr`` so it works against the real models later and against duck-typed
stubs in tests now.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from typing import Callable, List, Optional, Union

from . import catalog
from .selection import parse_cvss_vector, select_techniques
from .verdict import ENTRY_TACTICS, roll_up

logger = logging.getLogger(__name__)

STATUS_BLOCKED = "blocked"
STATUS_POSSIBLE = "possible"
STATUS_LIKELY = "likely"

# Statuses that mean the flaw is gone on this asset (patched / closed / retest-
# verified) — the finding is no longer exploitable. This is the codebase-wide
# "done" set: remediation_plans.py sets status="verified" only once a plan is
# applied AND verified, and vulnerabilities.py / dashboard.py / control_links.py
# all group these four as terminal-fixed. Shared with view.build_view so the
# chain badges and the remediation line can never disagree on what "done" means.
# Deliberately EXCLUDES "accepted" (risk accepted — the flaw still exists) and
# "false_positive" (not a real flaw — not-exploitable for a different reason).
REMEDIATED_STATUSES = {"resolved", "remediated", "verified", "closed"}


def _is_entry_technique(technique_id: str) -> bool:
    """True if the technique belongs to an entry tactic (Initial Access /
    Execution) — the capability a CVE-level exploit actually confirms.

    Exploit/KEV evidence escalates only these. A verified exploit proves "an
    attacker can get in", not that every downstream technique is reached. Recon
    is non-entry, so it's excluded here too (a known exploit doesn't make
    scanning more certain — scanning is either feasible or not).
    """
    tech = catalog.get_technique(technique_id)
    if not tech:
        # Shouldn't happen — selection draws from the same catalogue, so every
        # selected technique resolves here. If one doesn't (selection and
        # catalogue out of sync after a re-ingest), treat it as non-entry — safer
        # to under-claim than over-claim — but SHOUT: a silently-swallowed miss
        # would drop a real entry technique to POSSIBLE and understate
        # exploitability with no trace. Same fail-loud posture as the entry-tactic
        # shortname guard in verdict.py.
        logger.warning(
            "reachability: technique %s not found in the ATT&CK catalogue during "
            "entry-tactic check — treated as non-entry. Selection/catalogue may be "
            "out of sync (re-ingest?); a real entry technique could be understated.",
            technique_id,
        )
        return False
    return bool(ENTRY_TACTICS & set(tech.get("tactics") or []))


# ──────────────────────────────────────────────────────────────────────────
# Signals — the fixed vocabulary of facts about one vuln-on-one-asset
# ──────────────────────────────────────────────────────────────────────────
@dataclass
class Signals:
    # exposure / reachability
    internet_exposed: Optional[bool] = None
    network_reachable: Optional[bool] = None
    control_coverage: Optional[float] = None      # informational only — see module note
    # cvss-derived
    cvss_av: Optional[str] = None                 # N | A | L | P
    cvss_ui: Optional[str] = None                 # N | R
    cvss_pr: Optional[str] = None                 # N | L | H
    cvss_scope_changed: Optional[bool] = None
    # exploit intelligence
    has_public_exploit: Optional[bool] = None     # TRI-STATE: True/False/None(never checked)
    exploit_verified: Optional[bool] = None       # a maintainer-reproduced (Exploit-DB verified) exploit exists
    exploit_source: Optional[str] = None          # combined provenance, e.g. "github; exploit-db (verified)"
    in_kev: bool = False
    epss: Optional[float] = None
    # remediation
    patch_applied: Optional[bool] = None          # True only when remediated on this asset

    def as_dict(self) -> dict:
        return asdict(self)


def build_signals(vuln, asset, *, control_coverage: Optional[float] = None) -> Signals:
    """Assemble the signal set from a vulnerability + asset.

    Defensive by design: every read is a ``getattr`` with a default, so a model
    that's missing a field (or a test stub) degrades to "unknown" rather than
    raising. ``network_reachable`` is *derived* — the asset model has no such
    column yet (flagged) — from lifecycle: a live networked asset is reachable
    unless it's decommissioned/retired. Replace with a real column later without
    touching the rules.
    """
    # exposure
    internet_exposed = getattr(asset, "is_internet_facing", None)
    if internet_exposed is None:
        internet_exposed = getattr(asset, "internet_facing", None)

    lifecycle = (getattr(asset, "lifecycle_state", None) or "").lower()
    asset_status = (getattr(asset, "status", None) or "").lower()
    network_reachable = not (
        lifecycle in ("decommissioned", "retired") or asset_status == "decommissioned"
    )

    # cvss
    cvss = parse_cvss_vector(getattr(vuln, "cvss_vector", None))

    # exploit intel — corroborated across BOTH public-exploit sources (GitHub
    # PoC + Exploit-DB). True if EITHER found one; None (unknown) only if BOTH
    # were never checked; else False. exploit_verified = a maintainer-reproduced
    # Exploit-DB entry, the strongest grade the narrator can cite.
    gh_count = getattr(vuln, "public_exploit_count", None)
    edb_count = getattr(vuln, "exploitdb_count", None)
    if (gh_count or 0) > 0 or (edb_count or 0) > 0:
        has_public_exploit = True
    elif gh_count is None and edb_count is None:
        has_public_exploit = None
    else:
        has_public_exploit = False
    edb_verified = getattr(vuln, "exploitdb_verified_count", None)
    exploit_verified = None if edb_verified is None else (edb_verified > 0)

    # remediation
    vuln_status = (getattr(vuln, "status", None) or "").lower()
    patch_applied = True if vuln_status in REMEDIATED_STATUSES else (None if not vuln_status else False)

    return Signals(
        internet_exposed=internet_exposed,
        network_reachable=network_reachable,
        control_coverage=control_coverage,
        cvss_av=cvss.get("av"),
        cvss_ui=cvss.get("ui"),
        cvss_pr=cvss.get("pr"),
        cvss_scope_changed=cvss.get("scope_changed"),
        has_public_exploit=has_public_exploit,
        exploit_verified=exploit_verified,
        exploit_source=getattr(vuln, "exploit_source", None),
        in_kev=bool(getattr(vuln, "kev_flag", False)),
        epss=getattr(vuln, "epss_score", None),
        patch_applied=patch_applied,
    )


# ──────────────────────────────────────────────────────────────────────────
# Preconditions — a block predicate + the message that IS the "Why?"
# ──────────────────────────────────────────────────────────────────────────
class Precondition:
    """Blocks the technique when ``blocks_fn(signals)`` is True. ``why`` (str or
    signals->str) becomes the badge's reason on exactly that block."""

    __slots__ = ("blocks_fn", "why")

    def __init__(self, blocks_fn: Callable[[Signals], bool], why: Union[str, Callable[[Signals], str]]):
        self.blocks_fn = blocks_fn
        self.why = why

    def blocks(self, s: Signals) -> bool:
        return bool(self.blocks_fn(s))

    def explain(self, s: Signals) -> str:
        return self.why(s) if callable(self.why) else self.why


_AV_WORD = {"N": "Network", "A": "Adjacent", "L": "Local", "P": "Physical"}

# Applies to EVERY technique, checked first.
_UNIVERSAL: List[Precondition] = [
    Precondition(
        lambda s: s.patch_applied is True,
        "The fix has been applied on this asset — the weakness no longer exists here.",
    ),
]

# Technique-specific hard preconditions. Only the exploitation techniques that
# need a real gate are listed; everything else uses _UNIVERSAL + the default.
_RULES = {
    # Recon — feasible against any reachable target.
    "T1595": [
        Precondition(
            lambda s: s.network_reachable is False,
            "The asset isn't network-reachable, so it can't be scanned.",
        ),
    ],
    # Initial access over the internet.
    "T1190": [
        Precondition(
            lambda s: s.internet_exposed is False,
            "The asset isn't internet-exposed, so its public-facing surface can't be reached from outside.",
        ),
        Precondition(
            lambda s: s.cvss_av is not None and s.cvss_av != "N",
            lambda s: f"The vulnerability isn't network-exploitable — its attack vector is {_AV_WORD.get(s.cvss_av, s.cvss_av)}, not Network.",
        ),
    ],
    # Lateral movement by exploiting a remote service.
    "T1210": [
        Precondition(
            lambda s: s.network_reachable is False,
            "The asset isn't network-reachable, so its remote services can't be exploited.",
        ),
        Precondition(
            lambda s: s.cvss_av is not None and s.cvss_av in ("L", "P"),
            lambda s: f"The vulnerability needs {_AV_WORD.get(s.cvss_av, s.cvss_av)} access, not network access.",
        ),
    ],
    # Client-side execution needs both a user-interaction path and a real exploit.
    "T1203": [
        Precondition(
            lambda s: s.cvss_ui is not None and s.cvss_ui != "R",
            "The vulnerability doesn't require user interaction, so a client-execution path doesn't apply.",
        ),
        Precondition(
            lambda s: s.has_public_exploit is False,
            "No public exploit is known, so client-side execution isn't demonstrated.",
        ),
    ],
    # User execution is social — needs the interaction path, not a weaponized exploit.
    "T1204": [
        Precondition(
            lambda s: s.cvss_ui is not None and s.cvss_ui != "R",
            "The vulnerability doesn't require user interaction, so there's no user-execution path to abuse.",
        ),
    ],
}


def _confirmation(s: Signals) -> Optional[str]:
    """A confirmation signal escalates POSSIBLE -> LIKELY. Only facts that mean
    'not merely theoretical' qualify: CISA-confirmed active exploitation, or a
    published working exploit. EPSS is deliberately excluded here (it feeds the
    Layer 4 signal-%, not the badge) to avoid over-escalating on a probability.
    """
    if s.in_kev:
        return "CISA lists this vulnerability as known-exploited in the wild (KEV)."
    if s.has_public_exploit is True:
        if s.exploit_verified:
            return "A verified, maintainer-reproduced public exploit is available (Exploit-DB)."
        src = f" ({s.exploit_source})" if s.exploit_source else ""
        return f"A public exploit is available for this vulnerability{src}."
    return None


# ──────────────────────────────────────────────────────────────────────────
# The assessment
# ──────────────────────────────────────────────────────────────────────────
def assess_technique(technique_id: str, signals: Signals) -> dict:
    """Badge one technique against the signals. Returns {status, why, confirmed}."""
    for pre in _UNIVERSAL + _RULES.get(technique_id, []):
        if pre.blocks(signals):
            return {"status": STATUS_BLOCKED, "why": pre.explain(signals), "confirmed": False}

    # Exploit / KEV evidence escalates POSSIBLE -> LIKELY, but ONLY for the
    # technique the exploit actually enables — the entry capability (Initial
    # Access / Execution). A verified exploit for the CVE proves "an attacker can
    # get in", not that every downstream technique is reached; escalating all of
    # them would assert confidence the engine doesn't have — the mirror image of
    # the "Blocked only on a definite fact" invariant. Non-entry techniques
    # (privilege escalation, lateral movement, collection, ...) keep whatever
    # their OWN signals justify: reaching them presupposes a foothold this
    # CVE-level evidence doesn't establish. This narrowing only strips the
    # *exploit-borrowed* LIKELY; a non-entry technique that is LIKELY for its own
    # reason stays LIKELY. It also aligns the badges with the verdict, which
    # already reasons only on the entry set.
    if _is_entry_technique(technique_id):
        confirmation = _confirmation(signals)
        if confirmation:
            return {"status": STATUS_LIKELY, "why": confirmation, "confirmed": True}

    return {
        "status": STATUS_POSSIBLE,
        "why": "The earlier steps hold; an attacker could attempt this, but it isn't confirmed exploited in the wild.",
        "confirmed": False,
    }


def assess_chain(selected: List[dict], signals: Signals) -> List[dict]:
    """Attach a reachability badge to each technique Layer 2 selected. Returns
    new records (input is not mutated), preserving kill-chain order.
    """
    out: List[dict] = []
    for tech in selected or []:
        verdict = assess_technique(tech["technique_id"], signals)
        out.append({**tech, **verdict})
    return out


def evaluate(vuln, asset, *, control_coverage: Optional[float] = None) -> dict:
    """Full Layer 2 + Layer 3 for one vulnerability on one asset — the entry
    point the app/UI will call.

    Returns the badged technique chain plus the signal set it was judged
    against (for the evidence panel). Selection reads the vuln's CWE + CVSS;
    reachability reads the asset's exposure + the vuln's exploit intel.
    """
    selected = select_techniques(getattr(vuln, "cwe_id", None), getattr(vuln, "cvss_vector", None))
    signals = build_signals(vuln, asset, control_coverage=control_coverage)
    chain = assess_chain(selected, signals)
    return {
        "chain": chain,
        "signals": signals.as_dict(),
        # Which signals are DERIVED vs stored facts — so the UI can mark them and
        # nobody mistakes a derivation for a scanned/stored value. Keep this
        # honest: as real fields land, move keys out of here.
        "signal_notes": {
            "network_reachable": "derived from asset lifecycle — no stored field yet, not a scanned fact",
        },
        "counts": {
            STATUS_BLOCKED: sum(1 for t in chain if t["status"] == STATUS_BLOCKED),
            STATUS_POSSIBLE: sum(1 for t in chain if t["status"] == STATUS_POSSIBLE),
            STATUS_LIKELY: sum(1 for t in chain if t["status"] == STATUS_LIKELY),
        },
        # Layer 4 — the top-line verdict + signal % the card renders.
        "rollup": roll_up(chain, signals),
    }
