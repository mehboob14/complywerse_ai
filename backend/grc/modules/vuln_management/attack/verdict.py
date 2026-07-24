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
    return [t for t in chain if ENTRY_TACTICS & set(t.get("tactics") or [])]


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
    clamp = {
        VERDICT_LIKELY: ("raise", "Reachable and confirmed — exploit probability should be floored high, above raw EPSS."),
        VERDICT_POSSIBLE: ("neutral", "Reachable but unconfirmed — use EPSS as-is."),
        VERDICT_UNLIKELY: ("hold", "Not reachable here — hold exploit probability near/below EPSS regardless of severity."),
    }[verdict]

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
