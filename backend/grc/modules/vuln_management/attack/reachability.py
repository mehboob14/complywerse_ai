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
from typing import Callable, List, Optional, Tuple, Union

from . import catalog
from .selection import parse_cvss_vector, select_techniques
from .verdict import ENTRY_TACTICS, apply_wall_to_rollup, roll_up

logger = logging.getLogger(__name__)

STATUS_BLOCKED = "blocked"
STATUS_POSSIBLE = "possible"
STATUS_LIKELY = "likely"
# A post-foothold technique that is possible/likely ON ITS OWN signals but sits past
# a shut entry door: the chain can't reach it. Distinct from BLOCKED (this technique's
# own precondition fails) — SEVERED means an EARLIER gate is shut. See apply_chain_severing.
STATUS_SEVERED = "severed"

# Tactics an attacker reaches WITHOUT a foothold — reconnaissance happens before the
# door, resource-development is off-target prep. Single source of truth: view.py
# imports this. Everything NOT in here and NOT an entry tactic is post-foothold and
# only reachable once an entry step is actually open.
PRE_ENTRY_TACTICS = {"reconnaissance", "resource-development"}

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
    """True if the technique's PRIMARY (displayed) tactic is an entry tactic
    (Initial Access / Execution) — the capability a CVE-level exploit confirms.

    Exploit/KEV evidence escalates only these. A verified exploit proves "an
    attacker can get in", not that every downstream technique is reached. Recon
    is non-entry, so it's excluded here too (a known exploit doesn't make
    scanning more certain — scanning is either feasible or not).

    Why the PRIMARY tactic, not *any* tactic: ATT&CK v19 tags post-foothold
    techniques with a secondary entry tag — T1574 Hijack Execution Flow and the
    proxy-execution utilities carry 'execution'; T1078 Valid Accounts carries
    'initial-access'. Keying on ``set(tactics) & ENTRY`` escalated all 25 of them
    to LIKELY-because-KEV while they render under their primary tactic ('stealth',
    'persistence', …) — a badge that contradicts its own label AND over-claims a
    foothold the CVE never proves (an RCE doesn't hand the attacker valid creds or
    a planted DLL). ``tactics[0]`` is the same primary ``view.build_view`` renders,
    so the badge and the tactic label can never disagree. This only ever strips
    exploit-borrowed LIKELY from non-entry-positioned techniques; every genuine
    entry technique (T1190 initial-access, T1203/T1059 execution) has its entry
    tactic first and is unaffected.
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
    tactics = tech.get("tactics") or []
    primary = tactics[0] if tactics else None
    return primary in ENTRY_TACTICS


def primary_tactic(tech: dict) -> Optional[str]:
    """The technique's PRIMARY tactic — the one that fixes its kill-chain POSITION:
    the earliest (lowest matrix order) of its tactics. This is the same primary
    ``view.build_view`` renders as ``t["tactic"]`` and the spine groups by, defined
    in ONE place so the sequential stage gate and the rendered grouping can never
    disagree about which stage a technique sits in.
    """
    tactics = tech.get("tactics") or []
    if not tactics:
        return None
    return min(
        tactics,
        key=lambda s: (catalog.tactic_order(s) is None, catalog.tactic_order(s) or 0),
    )


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
    # exposure — TWO columns populated by DIFFERENT subsystems: the asset form and
    # CSV import write `internet_facing`; discovery (deep_collect) and the risk-posture
    # editor write `is_internet_facing`. Neither alone is authoritative, and
    # `is_internet_facing` is non-nullable (always a concrete False), so the old
    # "is_internet_facing first, else internet_facing" read IGNORED a True set via the
    # asset form — an internet-facing host read as "Not exposed" and its chain was
    # wrongly severed, while the score panel (which reads internet_facing) said the
    # opposite. Resolve consistently: exposed if EITHER says so; unknown only when both
    # are truly unknown; otherwise not-exposed.
    _isf = getattr(asset, "is_internet_facing", None)
    _inet = getattr(asset, "internet_facing", None)
    if _isf is True or _inet is True:
        internet_exposed = True
    elif _isf is None and _inet is None:
        internet_exposed = None
    else:
        internet_exposed = False

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


def _possible_why(technique_id: str, s: Signals) -> str:
    """The reason a technique is POSSIBLE, built from the ACTUAL signals rather than a
    fixed template — what keeps this step reachable on THIS asset, and why the evidence
    doesn't (yet) escalate it to LIKELY. Mirrors how BLOCKED and LIKELY already cite
    their concrete fact instead of boilerplate.
    """
    facts: List[str] = []
    if s.internet_exposed is True:
        facts.append("this host is internet-facing")
    elif s.network_reachable:
        facts.append("this host is reachable on the network")
    if _is_entry_technique(technique_id):
        if s.cvss_av == "N":
            facts.append("the flaw is exploitable over the network")
        elif s.cvss_av == "A":
            facts.append("the flaw is exploitable from an adjacent network")
        elif s.cvss_av == "L":
            facts.append("the flaw is exploitable with local access")
    reach = "; ".join(facts) if facts else "nothing on this asset disqualifies it"
    if s.has_public_exploit is False:
        conf = "no public exploit is known for it and it is not on CISA KEV"
    elif s.has_public_exploit is None:
        conf = "exploit availability has not been checked and it is not on CISA KEV"
    else:
        conf = "it is not on CISA KEV"
    return (f"An attacker could attempt this — {reach}. It stays possible rather than "
            f"confirmed because {conf}.")


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
        "why": _possible_why(technique_id, signals),
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


def _severed_reason(entry_state: Optional[str]) -> str:
    """The concrete why for a downstream stage the chain can't reach — matched to the
    verdict's entry_state so the badge, spine and narrator all give the SAME reason."""
    if entry_state == "assumed_insufficient":
        return ("The chain is assumed — no CWE or CVSS vector is recorded for this finding, "
                "so the path is a guess, not derived. No stage is confirmed reachable.")
    if entry_state == "none":
        return ("No network entry step applies to this finding, so an attacker can't reach this "
                "stage without already having local access to the asset.")
    return ("The entry step is blocked on this asset, so the chain is severed at the door and "
            "can't reach this stage.")


def apply_chain_severing(chain: List[dict], entry_state: Optional[str]) -> List[dict]:
    """Push the kill-chain's SEQUENTIAL gate down onto the per-technique badges.

    Layer 3 badges each technique on its OWN signals, so a post-foothold technique
    (privilege escalation, lateral movement, …) can read POSSIBLE even when the only
    way IN is blocked — a "capability" view. The spine already hides those, but the
    chain the narrator, the replay and the counts read kept the raw POSSIBLE, so the
    walkthrough narrated an "open path" the same screen said was severed.

    This closes that gap in ONE place: when the entry door is not open, any
    post-foothold technique that is POSSIBLE/LIKELY on its own is re-badged SEVERED —
    an attacker who can't get in can't reach it. A technique BLOCKED on its own keeps
    that (more specific) reason; entry and pre-entry (recon) stages are untouched.
    Pure and idempotent (new records; SEVERED is not possible/likely so a second pass
    is a no-op). entry_state=="open" (a real way in exists) → downstream stands on its
    own signals, unchanged.
    """
    if entry_state == "open":
        return chain
    reason = _severed_reason(entry_state)
    out: List[dict] = []
    for t in chain:
        tactic = (t.get("tactics") or [None])[0]
        if (tactic not in PRE_ENTRY_TACTICS and tactic not in ENTRY_TACTICS
                and t.get("status") in (STATUS_POSSIBLE, STATUS_LIKELY)):
            out.append({**t, "status": STATUS_SEVERED, "why": reason, "severed": True})
        else:
            out.append(t)
    return out


def apply_stage_walls(chain: List[dict], entry_state: Optional[str]) -> Tuple[List[dict], Optional[str]]:
    """Sequential stage gating PAST the door — the intermediate-wall rule.

    ``apply_chain_severing`` handles the ENTRY gate: when no way in is open,
    everything post-foothold is severed at the door. This closes the case that
    gate left open: entry IS open, but some LATER stage has techniques and every
    one of them is individually blocked. Walking the tactic spine in MITRE
    matrix order:

    * a stage with NO mapped techniques is TRANSPARENT — the flaw contributes
      nothing at that tactic, the chain passes through unchanged (established
      behaviour, kept);
    * a stage with at least one passable technique (possible/likely) is PASSED;
    * a stage whose techniques are ALL blocked is a WALL — every passable
      technique on any LATER stage is re-badged SEVERED, with a why that names
      the wall stage, because a chain that can't get past the wall can't reach
      it. A later technique BLOCKED on its own keeps that (more specific) reason.

    Pre-entry stages (recon / resource-development) happen before the door and
    stand alone — they never gate. The entry stages (Initial Access / Execution)
    are the POOLED door the verdict already reasons on — any one open way in
    means in — so they aren't wall candidates either; the first wall can only be
    a post-foothold stage.

    Returns ``(chain, walled_at_shortname)``. Pure, deterministic and idempotent:
    when entry is not open this is a strict no-op (the entry gate already severed
    downstream, so entry-blocked findings render IDENTICALLY to before this rule
    existed), and a second pass finds the same first wall and changes nothing
    (severed is not passable, so the wall stays where it was).
    """
    if entry_state != "open" or not chain:
        return chain, None
    # Group by the PRIMARY tactic — the same grouping the view renders and the
    # spine uses, so the wall can never sit in a different stage than the UI shows.
    by_stage: dict = {}
    for t in chain:
        sn = primary_tactic(t)
        if sn is not None:
            by_stage.setdefault(sn, []).append(t)
    wall_sn: Optional[str] = None
    wall_order: Optional[int] = None
    for sn, techs in sorted(by_stage.items(), key=lambda kv: catalog.tactic_order(kv[0]) or 0):
        order = catalog.tactic_order(sn)
        if order is None or sn in PRE_ENTRY_TACTICS or sn in ENTRY_TACTICS:
            continue
        if not any(t.get("status") in (STATUS_POSSIBLE, STATUS_LIKELY) for t in techs):
            wall_sn, wall_order = sn, order
            break
    if wall_sn is None or wall_order is None:
        return chain, None
    wall_name = (catalog.get_tactic(wall_sn) or {}).get("name") or wall_sn
    reason = (f"A required earlier stage ({wall_name}) is fully blocked on this asset, "
              f"so the chain cannot reach this technique.")
    out: List[dict] = []
    for t in chain:
        sn = primary_tactic(t)
        order = catalog.tactic_order(sn) if sn else None
        if (order is not None and order > wall_order
                and t.get("status") in (STATUS_POSSIBLE, STATUS_LIKELY)):
            out.append({**t, "status": STATUS_SEVERED, "why": reason, "severed": True})
        else:
            out.append(t)
    return out, wall_sn


def evaluate(vuln, asset, *, control_coverage: Optional[float] = None) -> dict:
    """Full Layer 2 + Layer 3 for one vulnerability on one asset — the entry
    point the app/UI will call.

    Returns the badged technique chain plus the signal set it was judged
    against (for the evidence panel). Selection reads the vuln's CWE + CVSS;
    reachability reads the asset's exposure + the vuln's exploit intel.
    """
    # Prefer the full CWE list (all NVD weaknesses — a Secondary is often the more
    # specific, better-mapping one); fall back to the single Primary. select_techniques
    # accepts either a list or a scalar.
    selected = select_techniques(
        getattr(vuln, "cwe_ids", None) or getattr(vuln, "cwe_id", None),
        getattr(vuln, "cvss_vector", None),
    )
    signals = build_signals(vuln, asset, control_coverage=control_coverage)
    chain = assess_chain(selected, signals)
    # Verdict FIRST (reasons only on the entry set, so it's unaffected by severing),
    # then push its entry_state gate onto the downstream badges so the chain the
    # narrator, replay and counts read agrees with the spine — no POSSIBLE step past
    # a shut door.
    rollup = roll_up(chain, signals)
    chain = apply_chain_severing(chain, rollup.get("entry_state"))
    # Sequential gate PAST the door: with entry open, a fully-blocked intermediate
    # stage walls the chain — later techniques read SEVERED (naming the wall) and
    # the verdict is weakened to say where the chain stops. No-op when entry is
    # not open, so entry-blocked findings are byte-identical to before.
    chain, walled_at = apply_stage_walls(chain, rollup.get("entry_state"))
    if walled_at:
        rollup = apply_wall_to_rollup(rollup, walled_at)
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
            STATUS_SEVERED: sum(1 for t in chain if t["status"] == STATUS_SEVERED),
        },
        # Layer 4 — the top-line verdict + signal % the card renders.
        "rollup": rollup,
    }
