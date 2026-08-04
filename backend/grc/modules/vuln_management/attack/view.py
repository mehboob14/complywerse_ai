"""The exploitability API contract — one JSON shape for one (vuln x asset).

This is the presentation layer over the engine: it calls ``reachability.evaluate``
and enriches it into the payload the Exploit Test tab renders *and* the future
attacker-walkthrough narrator reads from the same route. Pure and DB-free — the
thin router loads the vuln + asset and hands them here, so this stays unit-
testable with stubs.

Design intent — carry the *evidence trail*, not just the badges:
* every technique keeps its ``status`` + ``why`` + provenance (which mechanism
  selected it) so a narrator can cite why, never invent it;
* ``mitigations`` per technique (ATT&CK M-codes) is the grounded "what stops
  this step", replacing the hand-written blurbs the current TSX carries;
* the ``evidence`` block surfaces the graded public-exploit signal — source and
  verified count, not a bare boolean — so "Likely" always comes with a why.

The MITRE attribution rides in the payload: it must appear anywhere the chain is
rendered or exported.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import List, Optional

from . import catalog, threat_intel
from .reachability import (
    evaluate, primary_tactic, REMEDIATED_STATUSES,
    PRE_ENTRY_TACTICS as _PRE_ENTRY_TACTICS,
)
from .verdict import ENTRY_TACTICS


# MITRE ATT&CK descriptions are stored as raw markdown — inline "(Citation: …)"
# markers and "[label](url)" cross-links. Rendered verbatim they read as junk. Strip
# the citations and reduce each link to its label so the panel shows clean prose.
_CITATION_RE = re.compile(r"\s*\(Citation:[^)]*\)")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\(https?://[^)]+\)")


def _clean_attack_text(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    text = _MD_LINK_RE.sub(r"\1", text)      # [Exploit Public-Facing Application](url) -> the label
    text = _CITATION_RE.sub("", text)         # drop "(Citation: Botnet Scan)" noise
    text = re.sub(r"[ \t]{2,}", " ", text)    # collapse the double-spaces those leave behind
    return text.strip()


def _asset_exposed(asset) -> Optional[bool]:
    # `internet_facing` is the canonical exposure column; `is_internet_facing` is the
    # retired duplicate, honoured only as a fallback for legacy rows. Exposed if EITHER
    # is true; unknown only when both are unknown. Matches reachability.build_signals so
    # the exploit payload's asset block and the reachability badges can never disagree.
    inet = getattr(asset, "internet_facing", None)
    isf = getattr(asset, "is_internet_facing", None)
    if inet is True or isf is True:
        return True
    if inet is None and isf is None:
        return None
    return False


def _exploitdb_generated_at() -> Optional[str]:
    """As-of stamp of the offline Exploit-DB mirror, or None if the cache is cold."""
    try:
        from ..enrichment.exploitdb_cache import cache_status
        return cache_status().get("generated_at")  # type: ignore[return-value]
    except Exception:
        return None


# Tactics an attacker reaches WITHOUT a foothold (recon / resource-development) —
# imported from reachability so the spine gate and the chain-severing gate can never
# disagree on which stages are pre-entry. Everything else is post-foothold and only
# reachable when some entry step is open.


def _spine_stage_status(shortname, techs, entry_state, wall=None):
    """Honest per-stage status for the kill-chain spine — the gate the old spine
    lacked.

    ``techs`` is the chain entries whose PRIMARY tactic is this stage (the same
    grouping the view renders). ``wall`` is ``(order, name)`` of the intermediate
    WALL stage when the sequential gate found one (entry open but a later stage
    fully blocked — see ``reachability.apply_stage_walls``), else None.
    Returns ``(status, reason)``:

    * ``not_applicable`` — no technique maps to this stage for this finding.
    * ``reached``        — a technique maps here AND the chain can actually get here.
    * ``unreachable``    — a technique maps here but the chain can't reach it:
      every technique on this stage is blocked, this stage sits past an
      intermediate wall, or this is a post-foothold stage and no entry step is
      open.

    So a late stage can no longer light up green while the door (Initial Access /
    Execution) is blocked or absent — the exact contradiction the audit found.
    """
    if not techs:
        return "not_applicable", "No ATT&CK technique maps to this stage for this finding."
    reachable = [t for t in techs if t.get("status") in ("possible", "likely")]
    if not reachable:
        # Past an intermediate WALL, the honest reason names the wall stage —
        # not an arbitrary technique's own block message (a mixed stage's first
        # technique may be blocked for its own unrelated reason).
        if wall is not None:
            _wall_order, _wall_name = wall
            _order = catalog.tactic_order(shortname)
            if _order is not None and _wall_order is not None and _order > _wall_order:
                return "unreachable", (
                    f"A required earlier stage ({_wall_name}) is fully blocked on this "
                    f"asset, so the chain cannot reach this stage."
                )
        # Every technique on this stage is blocked — surface the concrete reason.
        return "unreachable", techs[0].get("why") or "Every technique on this stage is blocked on this asset."
    # Reconnaissance / resource-development happen BEFORE the door — scanning a
    # reachable host needs no foothold — so they stand on their own.
    if shortname in _PRE_ENTRY_TACTICS:
        return "reached", None
    # EVERYTHING else — the entry tactics (Initial Access / Execution) AND every
    # post-foothold tactic — is "reached" only when the chain has a genuinely OPEN way
    # in (entry_state == "open": the verdict found a real, reachable entry technique).
    # If entry is severed / none / assumed, NOTHING downstream is reachable — a chain
    # that can't get in can't execute either. This is the gate that stops Execution
    # (or any later stage) lighting up while Initial Access is blocked.
    if entry_state == "open":
        return "reached", None
    if entry_state == "assumed_insufficient":
        return ("unreachable",
                "The chain is assumed — no CWE or CVSS vector is recorded for this finding, so "
                "the path is a guess, not derived, and is treated as unlikely. No stage is "
                "confirmed reachable.")
    if entry_state == "none":
        return ("unreachable",
                "No network entry step applies to this finding, so an attacker can't reach this "
                "stage without already having local access to the asset.")
    return ("unreachable",
            "The entry step is blocked on this asset, so the chain is severed at the door and "
            "can't reach this stage.")


def build_view(vuln, asset, *, control_coverage: Optional[float] = None,
               other_assets: Optional[List[dict]] = None,
               evaluated_at: Optional[str] = None) -> dict:
    """Full exploitability payload for one vulnerability on one asset.

    ``other_assets`` is the list of the OTHER assets this vuln is linked to (each
    ``{id, name, internet_facing}``). It exists so the UI and the narrator can
    say "assessed on THIS host, N others linked" — a one-asset verdict must never
    be rendered as the whole vulnerability's, or an internal ``assetLinks[0]``
    silently reads "Unlikely" while an internet-facing sibling is wide open. The
    router supplies it (a DB read); kept out of the pure core so this stays
    unit-testable. ``evaluated_at`` stamps when this assessment ran, distinct
    from the catalogue's ``attack_version`` — material once a narration is cached
    or exported ("assessed before the KEV listing landed" vs "this morning").
    """
    result = evaluate(vuln, asset, control_coverage=control_coverage)

    # Enrich each badged technique with its tactic display name and the ATT&CK
    # mitigations that counter it ("what stops this step").
    for t in result["chain"]:
        tactics = t.get("tactics") or []
        # Show the technique under the tactic that fixes its kill-chain POSITION — the
        # earliest (lowest matrix order) one, which is exactly the tactic its `order`
        # (min of its tactics' orders) came from. `tactics[0]` is arbitrary STIX order,
        # so a multi-tactic technique could read e.g. "Stealth" while sitting at
        # Execution's position — the label and the ordering disagreeing is what made the
        # chain look shuffled. This aligns the label, the sort order and the spine group.
        # Shared with reachability.apply_stage_walls (the sequential gate) so the wall
        # and the rendered grouping can never disagree about a technique's stage.
        primary = primary_tactic(t) if tactics else None
        tactic = catalog.get_tactic(primary) if primary else None
        t["tactic"] = primary
        t["tactic_name"] = tactic["name"] if tactic else None
        # Fix C — technique-SPECIFIC detail for the click panel, not a status
        # template: the ATT&CK technique's own description, and the concrete reason
        # THIS finding selected it (until now buried in provenance, never surfaced).
        tech_full = catalog.get_technique(t["technique_id"])
        t["description"] = _clean_attack_text(tech_full.get("description")) if tech_full else None
        _prov = t.get("provenance") or []
        t["mapping_reason"] = next(
            (p.get("why") or p.get("reason") or p.get("capec_name")
             for p in _prov if p.get("why") or p.get("reason") or p.get("capec_name")),
            None,
        )
        t["mitigations"] = [
            {"id": m["mitigation_id"], "name": m["name"], "url": m.get("url")}
            for m in catalog.mitigations_for(t["technique_id"])
        ]
        # Sub-technique legibility: tie e.g. "T1505.003 Web Shell" to its parent
        # "T1505 Server Software Component" so the reader sees the hierarchy. We do
        # NOT expand a parent into its subs or list variants — that would assert
        # specificity the CWE + vector can't derive (the "blocked only on a definite
        # fact" invariant, applied to selection).
        if t.get("is_subtechnique") and t.get("parent"):
            par = catalog.get_technique(t["parent"])
            t["parent_id"] = t["parent"]
            t["parent_name"] = par.get("name") if par else None

    # Vuln-specific remediation — the single most actionable line on the panel,
    # and unlike a technique-generic ATT&CK mitigation it is true of THIS CVE.
    # Sourced from fields we already hold (patch references / remediation guidance).
    patch_refs = getattr(vuln, "patch_references", None) or []
    patch_available = bool(patch_refs)
    remediated = (getattr(vuln, "status", "") or "").lower() in REMEDIATED_STATUSES
    _cve = getattr(vuln, "cve_id", None) or "this finding"
    if remediated:
        _patch_line = f"A vendor patch is available and this finding is marked resolved for {_cve}."
    elif patch_available:
        _patch_line = (f"Apply the vendor patch for {_cve}. It is the only step that removes the "
                       f"flaw itself; every other control only limits how far it reaches.")
    else:
        _patch_line = (f"No vendor patch is recorded for {_cve}. Apply a compensating control "
                       f"until one is published.")

    # Fix B — honest per-stage status on the full 15-tactic spine. A stage lights
    # up only when a technique maps here AND the chain can actually reach it; a
    # post-foothold stage stays dark when the entry step is blocked or absent, so
    # the spine can never show Lateral Movement "reached" while Initial Access is
    # shut. Ordering gate lives in _spine_stage_status, fed by the verdict's
    # entry_state.
    _rollup = result.get("rollup") or {}
    _entry_state = _rollup.get("entry_state")
    # The intermediate wall the sequential gate found (entry open, later stage
    # fully blocked) — present in the rollup only when one exists, so wall-free
    # findings keep today's exact spine reasons.
    _walled_at = _rollup.get("walled_at")
    _wall = (
        (catalog.tactic_order(_walled_at), _rollup.get("walled_at_name") or _walled_at)
        if _walled_at else None
    )
    _by_primary: dict = {}
    for t in result["chain"]:
        _by_primary.setdefault(t.get("tactic"), []).append(t)
    tactic_spine = []
    for tt in catalog.kill_chain_tactics():
        _sn = tt.get("shortname")
        _techs_here = _by_primary.get(_sn, [])
        _st, _reason = _spine_stage_status(_sn, _techs_here, _entry_state, wall=_wall)
        tactic_spine.append({
            "shortname": _sn,
            "name": tt.get("name"),
            "status": _st,                       # reached | unreachable | not_applicable
            "reason": _reason,
            "technique_ids": [t["technique_id"] for t in _techs_here],
        })

    status = catalog.catalog_status()
    return {
        "vuln_id": getattr(vuln, "id", None),
        "cve_id": getattr(vuln, "cve_id", None),
        # The weakness class — the narrator grounds the attacker's concrete actions
        # in it (CWE-22 → "escape the web root"), so a story can be told, not just
        # the badges restated.
        "cwe_id": getattr(vuln, "cwe_id", None),
        # No CWE → the chain is the coarse CVSS-vector fallback (the same generic ~3
        # techniques apply to every network finding), NOT a finding-specific attack
        # path. Flagged so the UI can say so honestly instead of dressing a generic
        # guess up as an analysis.
        "mapping_generic": not bool(getattr(vuln, "cwe_id", None) or (getattr(vuln, "cwe_ids", None) or [])),
        "evaluated_at": evaluated_at or datetime.now(timezone.utc).isoformat(),
        "asset": {
            "id": getattr(asset, "id", None),
            "name": getattr(asset, "name", None),
            "internet_facing": _asset_exposed(asset),
            "criticality": getattr(asset, "criticality", None),
            "environment": getattr(asset, "environment", None),
        },
        # Scope: this verdict is for THIS asset only. Surface the others so the UI
        # can label it honestly and the narrator never states a one-host verdict
        # as the whole vulnerability's.
        "asset_link_count": len(other_assets or []) + 1,
        "other_assets": list(other_assets or []),
        "attack_version": status.get("attack_version"),
        "attribution": catalog.MITRE_ATTRIBUTION,
        # Layer 4 — the top card.
        "verdict": result["rollup"],
        "counts": result["counts"],
        # Layer 2+3 — the per-step chain (already kill-chain ordered).
        "chain": result["chain"],
        # The full ordered ATT&CK tactic spine (all 15), each stage now carrying an
        # honest status: reached (a technique maps AND the chain can get here),
        # unreachable (maps but blocked or no open entry step), or not_applicable
        # (nothing maps). A short chain reads as HONEST — only what the evidence
        # justifies, kill-chain-ordered — never REDUCED and never contradictory.
        "tactic_spine": tactic_spine,
        # Technique-level threat-intel association (derived, read-only): which actors
        # and malware/tools MITRE records as USING the techniques in this chain. This
        # is NOT "actors who exploited this CVE" — no such link exists in the data;
        # the UI binds each actor list to the specific technique that carries it.
        # Derived from the chain, so it never enters the assessment hash.
        "threat_intel": threat_intel.for_chain(result["chain"]),
        # Vuln-specific remediation: the M-codes on each technique are the grounded
        # backbone ("what stops this step"); this is the one line true of THIS CVE,
        # not of the technique in general. Kept alongside, not instead of, M-codes.
        "remediation": {
            "patch_available": patch_available,
            "patch_applied": remediated,
            "line": _patch_line,
            "guidance": getattr(vuln, "remediation_guidance", None),
            "patch_references": patch_refs,
        },
        # The signal set the badges were judged against, + which are derived.
        "signals": result["signals"],
        "signal_notes": result["signal_notes"],
        # The graded public-exploit evidence trail — source + verified count, the
        # payload the narrator cites and the tab renders beyond a bare boolean.
        # exploitdb.generated_at is the offline mirror's as-of stamp (point-in-time,
        # not live) so the UI can be honest about signal freshness.
        "evidence": {
            "exploit_source": result["signals"].get("exploit_source"),
            "exploit_verified": result["signals"].get("exploit_verified"),
            "has_public_exploit": result["signals"].get("has_public_exploit"),
            "exploitdb": {
                "count": getattr(vuln, "exploitdb_count", None),
                "verified": getattr(vuln, "exploitdb_verified_count", None),
                "refs": getattr(vuln, "exploitdb_refs", None) or [],
                "generated_at": _exploitdb_generated_at(),
            },
            "github_poc": {
                "count": getattr(vuln, "public_exploit_count", None),
                "refs": getattr(vuln, "public_exploit_refs", None) or [],
            },
            "kev": bool(getattr(vuln, "kev_flag", False)),
            "epss": getattr(vuln, "epss_score", None),
        },
    }
