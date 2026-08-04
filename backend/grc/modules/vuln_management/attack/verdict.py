"""Layer 4 — roll-up & verdict. Per vulnerability-on-asset.

Collapses the per-technique badges from Layer 3 into the one line a human reads:
*Unlikely / Possibly / Likely to be exploitable* — plus a separate signal
percentage. The two are computed independently and on purpose, so they can never
contradict each other (the reference's core rule).

**Verdict** answers one question: is any complete way IN open? The entry tactics
are {Initial Access, Execution}. Recon being POSSIBLE is irrelevant — an attacker
who can scan but can't get through the door hasn't exploited anything. So:

    every entry technique BLOCKED  -> unlikely   (chain severed at the door)
    at least one POSSIBLE          -> possible
    at least one LIKELY            -> likely

One case the reference misses, found while building Layer 3: a purely *local*
vulnerability (AV:L) selects no entry-tactic technique at all — there's no front
door to blitz. That is NOT the same as "all doors blocked"; it means the attacker
must already be on the box. Handled as its own branch with its own wording.

**Signal %** is the simpler, separate number: the fraction of positive-
exploitability signals that are actually ON. It is a measure of how loud the
alarm is, not how open the door is. VULN-37 -> 0%.

**Exploit-probability clamp** is advisory output only — a recommendation for how
the risk score's exploit band should react to this verdict. It is NOT applied to
the stored score here; wiring it into the score is a deliberate later step.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from . import catalog

logger = logging.getLogger(__name__)

VERDICT_LIKELY = "likely"
VERDICT_POSSIBLE = "possible"
VERDICT_UNLIKELY = "unlikely"

ENTRY_TACTICS = {"initial-access", "execution"}

# The fixed set the signal-% is measured over — positive exploitability signals.
_EPSS_HOT = 0.10

# Advisory clamp for the risk score's exploit-probability band, keyed by verdict.
# Module-level so ``apply_wall_to_rollup`` can re-derive it after a wall weakens
# the verdict — the clamp and the verdict must never disagree.
_CLAMP_BY_VERDICT = {
    VERDICT_LIKELY: ("raise", "Reachable and confirmed — exploit probability should be floored high, above raw EPSS."),
    VERDICT_POSSIBLE: ("neutral", "Reachable but unconfirmed — use EPSS as-is."),
    VERDICT_UNLIKELY: ("hold", "Not reachable here — hold exploit probability near/below EPSS regardless of severity."),
}


_entry_validated = False


def _validate_entry_tactics() -> None:
    """Fail LOUD if a future ATT&CK re-ingest renames an entry-tactic shortname.

    The entry-step check keys on tactic *shortnames* ('initial-access',
    'execution') — ATT&CK's stable machine identifiers (x_mitre_shortname), the
    same key techniques carry in their ``tactics``. Shortnames are as stable as
    the TA-numbers and, unlike display names, were untouched by the v19 tactic
    split (Defense Evasion -> Stealth + Defense Impairment). But if a future
    release ever did rename one, the entry set would silently go empty and every
    finding would read 'unlikely' — a reassuring lie. So check once that the
    shortnames still resolve in the catalogue, and shout in the logs if not.
    """
    global _entry_validated
    if _entry_validated:
        return
    _entry_validated = True
    missing = [s for s in ENTRY_TACTICS if catalog.get_tactic(s) is None]
    if missing:
        logger.error(
            "verdict.ENTRY_TACTICS shortname(s) %s no longer exist in the loaded "
            "ATT&CK catalogue — a re-ingest likely renamed a tactic. Until fixed, "
            "the entry-step check is broken and every verdict will read 'unlikely'.",
            missing,
        )


def _entry_techniques(chain: List[dict]) -> List[dict]:
    # PRIMARY tactic only — the SAME definition reachability._is_entry_technique uses
    # for escalation. A technique is a "way in" iff its primary (displayed) tactic is
    # an entry tactic; a mere SECONDARY entry tag does NOT make a post-foothold
    # technique a door (T1078 Valid Accounts, T1574 Hijack Execution Flow, … carry
    # 'initial-access'/'execution' as a secondary tag but render under 'persistence'/
    # 'stealth'). Keying on ANY tactic double-counted those as entry steps: a CWE-20
    # finding on a NOT-internet-facing asset read 'possible' even though its only real
    # entry step (T1190) was blocked — contradicting the reachability layer, which had
    # already been fixed to primary-tactic. The chain carries the catalogue's tactic
    # list, so tactics[0] is the same primary the badge and view render.
    return [t for t in chain if (t.get("tactics") or [None])[0] in ENTRY_TACTICS]


def roll_up(chain: List[dict], signals) -> dict:
    """chain = Layer 3 badged techniques; signals = the Signals object. Returns
    the verdict block for the top card + the risk-score clamp recommendation.
    """
    _validate_entry_tactics()
    entry = _entry_techniques(chain)
    entry_statuses = {t["status"] for t in entry}

    if not entry:
        verdict = VERDICT_UNLIKELY
        reason = ("No network entry step applies to this vulnerability — exploiting it "
                  "would require an attacker who already has local access to the asset.")
        entry_state = "none"
    elif VERDICT_LIKELY in entry_statuses:
        verdict = VERDICT_LIKELY
        reason = "At least one way in is confirmed reachable — a known or publicly available exploit."
        entry_state = "open"
    elif VERDICT_POSSIBLE in entry_statuses:
        verdict = VERDICT_POSSIBLE
        reason = "At least one way in is open, though no confirmed exploitation was found."
        entry_state = "open"
    else:  # every entry technique BLOCKED
        verdict = VERDICT_UNLIKELY
        reason = "Every way in is blocked on this asset, so the attack chain is severed at the door."
        entry_state = "severed"

    # ── assumed-chain guard ──────────────────────────────────────────────────
    # A chain built ENTIRELY from the no-data fallback (no CWE, no CVSS vector — every
    # technique carries assumed=True) is a guess, not evidence. Left alone it can read
    # 'possible' on an internet-facing asset — which dresses "we know nothing about
    # this finding" up as a partial finding. Cap it at 'unlikely' with an honest
    # insufficient-data reason, UNLESS real exploit evidence (KEV or a public exploit)
    # corroborates it — in which case that evidence, not the assumed mapping, carries
    # the verdict and will already have escalated the entry step to LIKELY above.
    if (chain and all(t.get("assumed") for t in chain)
            and verdict == VERDICT_POSSIBLE
            and not (signals.in_kev is True or signals.has_public_exploit is True)):
        verdict = VERDICT_UNLIKELY
        reason = ("No CWE or CVSS vector is recorded for this finding, so the attack path "
                  "is assumed, not derived — and no public exploit or KEV listing "
                  "corroborates it. Treated as unlikely until the finding is enriched.")
        entry_state = "assumed_insufficient"

    # ── signal % — positive exploitability signals that are ON (kept separate) ──
    positive = {
        "internet_exposed": signals.internet_exposed is True,
        "public_exploit": signals.has_public_exploit is True,
        "in_kev": signals.in_kev is True,
        "epss_hot": signals.epss is not None and signals.epss >= _EPSS_HOT,
    }
    signal_pct = round(100 * sum(positive.values()) / len(positive))

    # ── data completeness — how much of the signal set we actually know ──
    known = [
        signals.internet_exposed is not None,
        signals.network_reachable is not None,
        signals.cvss_av is not None,
        signals.cvss_ui is not None,
        signals.cvss_pr is not None,
        signals.cvss_scope_changed is not None,
        signals.has_public_exploit is not None,
        True,                                    # in_kev is always a known bool
        signals.epss is not None,
        signals.patch_applied is not None,
    ]
    data_completeness = round(100 * sum(known) / len(known))

    # ── advisory clamp for the risk score's exploit-probability band ──
    clamp = _CLAMP_BY_VERDICT[verdict]

    return {
        "verdict": verdict,
        "verdict_reason": reason,
        "entry_state": entry_state,                 # open | severed | none
        "entry_technique_count": len(entry),
        "signal_pct": signal_pct,
        "signals_on": [k for k, v in positive.items() if v],
        "data_completeness": data_completeness,
        "exploit_probability": {
            "recommendation": clamp[0],             # raise | neutral | hold
            "rationale": clamp[1],
        },
    }


def apply_wall_to_rollup(rollup: dict, wall_shortname: str) -> dict:
    """Reflect an intermediate WALL in the verdict — the sequential-gating case
    where a way in IS open but a later stage's techniques are ALL blocked (see
    ``reachability.apply_stage_walls``), so the chain cannot progress past it.

    The door stands open — the entry techniques are genuinely passable — so the
    verdict never drops to 'unlikely' (that would deny a way in that exists).
    But a chain that cannot progress past the wall isn't 'likely' END-TO-END
    either, so LIKELY weakens one notch to POSSIBLE; and in BOTH cases the
    verdict_reason names the wall stage, so the weakening is never silent. The
    clamp is re-derived from the weakened verdict so the two can't disagree.

    Adds ``walled_at`` (shortname) + ``walled_at_name`` ONLY when applied — a
    finding with no wall keeps today's exact rollup shape, so unchanged findings
    produce identical payloads and no snapshot noise. Pure: returns a new dict.
    Deterministic: the reason depends only on the wall stage's catalogue name.
    """
    wall_name = (catalog.get_tactic(wall_shortname) or {}).get("name") or wall_shortname
    out = dict(rollup)
    walled_line = (f"the chain is walled at {wall_name} — every technique on that stage "
                   f"is blocked on this asset, so the attack cannot progress past it")
    if out.get("verdict") == VERDICT_LIKELY:
        out["verdict"] = VERDICT_POSSIBLE
        out["verdict_reason"] = f"A way in is confirmed reachable, but {walled_line}."
    elif out.get("verdict") == VERDICT_POSSIBLE:
        out["verdict_reason"] = f"At least one way in is open, but {walled_line}."
    else:
        # Defensive: a wall only exists when entry is open, and open entry never
        # rolls up 'unlikely' — nothing to weaken.
        return rollup
    clamp = _CLAMP_BY_VERDICT[out["verdict"]]
    out["exploit_probability"] = {"recommendation": clamp[0], "rationale": clamp[1]}
    out["walled_at"] = wall_shortname
    out["walled_at_name"] = wall_name
    return out
