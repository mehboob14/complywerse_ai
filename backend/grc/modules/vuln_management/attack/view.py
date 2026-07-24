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

from datetime import datetime, timezone
from typing import List, Optional

from . import catalog
from .reachability import evaluate, REMEDIATED_STATUSES


def _asset_exposed(asset) -> Optional[bool]:
    v = getattr(asset, "is_internet_facing", None)
    if v is None:
        v = getattr(asset, "internet_facing", None)
    return v


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
        primary = tactics[0] if tactics else None
        tactic = catalog.get_tactic(primary) if primary else None
        t["tactic"] = primary
        t["tactic_name"] = tactic["name"] if tactic else None
        t["mitigations"] = [
            {"id": m["mitigation_id"], "name": m["name"], "url": m.get("url")}
            for m in catalog.mitigations_for(t["technique_id"])
        ]

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

    status = catalog.catalog_status()
    return {
        "vuln_id": getattr(vuln, "id", None),
        "cve_id": getattr(vuln, "cve_id", None),
        # The weakness class — the narrator grounds the attacker's concrete actions
        # in it (CWE-22 → "escape the web root"), so a story can be told, not just
        # the badges restated.
        "cwe_id": getattr(vuln, "cwe_id", None),
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
        "evidence": {
            "exploit_source": result["signals"].get("exploit_source"),
            "exploit_verified": result["signals"].get("exploit_verified"),
            "has_public_exploit": result["signals"].get("has_public_exploit"),
            "exploitdb": {
                "count": getattr(vuln, "exploitdb_count", None),
                "verified": getattr(vuln, "exploitdb_verified_count", None),
                "refs": getattr(vuln, "exploitdb_refs", None) or [],
            },
            "github_poc": {
                "count": getattr(vuln, "public_exploit_count", None),
                "refs": getattr(vuln, "public_exploit_refs", None) or [],
            },
            "kev": bool(getattr(vuln, "kev_flag", False)),
            "epss": getattr(vuln, "epss_score", None),
        },
    }
