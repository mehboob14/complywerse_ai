"""Remediation plan generation.

Produces the four things a fix plan needs — a title, a narrative summary, a
copy-pasteable fix artifact, and a rationale that shows its working — from
whatever we know about the finding and the asset it sits on.

Two paths, and the important one is the second:

  1. AI, when a model is configured and answers with usable JSON.
  2. A DETERMINISTIC HEURISTIC otherwise.

The heuristic is not a degraded mode we apologise for. It is templated from
real fields (CVSS, EPSS, KEV, internet exposure, asset criticality) and always
produces a plan an engineer can act on. The AI path only ever *replaces* text —
if it returns anything malformed we silently keep the heuristic, because a
plan that always exists beats a better plan that sometimes doesn't.

The generated plan is stored, not recomputed, so the approval and the evidence
attach to one immutable artifact.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

VALID_FIX_TYPES = {"patch", "script", "iac", "config"}


# ─── fix type ───────────────────────────────────────────────────────────────

def choose_fix_type(asset_type: Optional[str], asset_name: Optional[str], os_family: Optional[str]) -> str:
    """Pick the shape of the fix from what the asset actually is.

    We look at the asset's TYPE first and only fall back to its name. The
    reference product matches on the name alone, which mislabels anything
    unluckily named ("cloud-db-01" is not necessarily infrastructure-as-code).
    """
    blob = " ".join(filter(None, [asset_type, os_family])).lower()
    name = (asset_name or "").lower()

    if any(k in blob for k in ("cloud", "container", "kubernetes", "k8s")):
        return "iac"
    if any(k in blob for k in ("network", "firewall", "appliance", "router", "switch", "cisco")):
        return "config"
    # Only consult the name when the type told us nothing useful.
    if not blob.strip():
        if any(k in name for k in ("cloud", "container", "k8s")):
            return "iac"
        if any(k in name for k in ("fw", "firewall", "switch", "router", "vpn")):
            return "config"
    return "patch"


# ─── fix artifacts ──────────────────────────────────────────────────────────

def _artifact(fix_type: str, cve: str, asset: str, os_family: Optional[str]) -> str:
    osf = (os_family or "").lower()

    if fix_type == "patch":
        # Lead with the package manager the asset actually uses; list the
        # others as comments so the artifact stays useful if we guessed wrong.
        if "windows" in osf:
            steps = (
                "3. Apply the update:\n"
                "     Windows:  Install the security update via WSUS/Intune, or\n"
                "               Get-WindowsUpdate -Install -KBArticleID <KB>\n"
            )
        elif any(k in osf for k in ("rhel", "centos", "rocky", "alma", "oracle")):
            steps = (
                "3. Apply the update:\n"
                "     RHEL family:  sudo yum update <package>\n"
                "     # Debian/Ubuntu: sudo apt-get install --only-upgrade <package>\n"
            )
        elif any(k in osf for k in ("debian", "ubuntu")):
            steps = (
                "3. Apply the update:\n"
                "     Debian/Ubuntu:  sudo apt-get update && sudo apt-get install --only-upgrade <package>\n"
                "     # RHEL family:  sudo yum update <package>\n"
            )
        else:
            steps = (
                "3. Apply the update:\n"
                "     Debian/Ubuntu:  sudo apt-get update && sudo apt-get install --only-upgrade <package>\n"
                "     RHEL family:    sudo yum update <package>\n"
                "     Windows:        install the vendor security update via WSUS/Intune\n"
            )
        return (
            f"# Remediation steps for {cve} on {asset}\n"
            f"1. Identify the affected package or component reported for {cve}.\n"
            f"2. Stage the vendor security update in a change window.\n"
            f"{steps}"
            f"4. Reboot if a kernel or service restart is required.\n"
            f"5. Re-scan {asset} to confirm {cve} is no longer detected.\n"
        )

    if fix_type == "script":
        return (
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            f"# Remediation for {cve} on {asset}\n"
            f'echo "Applying security update for {cve}..."\n'
            "if command -v apt-get >/dev/null; then\n"
            "  sudo apt-get update && sudo apt-get upgrade -y\n"
            "elif command -v yum >/dev/null; then\n"
            "  sudo yum update -y\n"
            "fi\n"
            f'echo "Done. Re-scan {asset} to verify closure."\n'
        )

    if fix_type == "iac":
        return (
            f"# Infrastructure-as-code change for {cve} on {asset}\n"
            "# Pin the affected component to a patched version and re-apply.\n"
            "# Example — adjust to your provider or module:\n"
            '#   image = "<patched-image>:<fixed-tag>"\n'
            "# Then:\n"
            "#   terraform plan && terraform apply\n"
            f"# Finally, re-scan {asset} to confirm {cve} is cleared.\n"
        )

    return (
        f"# Configuration change / compensating control for {cve} on {asset}\n"
        "# Use this when an immediate patch is not available.\n"
        "# 1. Restrict inbound access to the affected service to trusted networks.\n"
        f"# 2. Apply a virtual patch or WAF rule for {cve}.\n"
        "# 3. Disable the vulnerable feature or module if it is not required.\n"
        "# 4. Record this as a compensating control and keep the finding open\n"
        "#    until the vendor patch is applied.\n"
    )


def rollback_for(fix_type: str) -> str:
    return {
        "patch": "Roll back the package to the previous version from your package cache "
                 "(apt-get install <package>=<old-version>, or yum history undo <id>) and reboot if required.",
        "script": "Re-run the previous known-good configuration script, or restore the host "
                  "from the pre-change snapshot taken at the start of the change window.",
        "iac": "Revert the infrastructure-as-code commit and re-apply the previous plan "
               "(git revert <sha> && terraform apply).",
        "config": "Restore the previous device configuration from backup and remove the "
                  "virtual patch or WAF rule that was added.",
    }.get(fix_type, "Restore the previous configuration from backup.")


# ─── SLA pressure ───────────────────────────────────────────────────────────

def _urgency(score: float) -> str:
    if score >= 80:
        return "Remediate within 24 hours."
    if score >= 60:
        return "Remediate within 7 days."
    if score >= 40:
        return "Remediate within 30 days."
    return "Schedule at the next maintenance window."


def _pressures(ctx: Dict[str, Any]) -> list[str]:
    out: list[str] = []
    if ctx.get("kev"):
        out.append("listed in CISA KEV (actively exploited)")
    # Every phrase here must read correctly after "This finding is …", so they
    # are adjectival, not verb phrases.
    if (ctx.get("epss") or 0) >= 0.5:
        out.append(f"rated {round((ctx['epss'] or 0) * 100)}% likely to be exploited within 30 days")
    n = ctx.get("public_exploit_count") or 0
    if n > 0:
        out.append(f"backed by {n} public exploit{'' if n == 1 else 's'}")
    if ctx.get("internet_facing"):
        out.append("internet-facing")
    if (ctx.get("asset_criticality") or "").lower() == "critical":
        out.append("on a business-critical asset")
    return out


# ─── heuristic plan ─────────────────────────────────────────────────────────

def heuristic_plan(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Build a complete, actionable plan from the fields alone. Never fails."""
    cve = ctx.get("cve_id") or f"VULN-{ctx.get('vuln_id')}"
    asset = ctx.get("asset_name") or "the affected asset"
    score = float(ctx.get("risk_score") or 0)
    fix_type = choose_fix_type(ctx.get("asset_type"), ctx.get("asset_name"), ctx.get("os_family"))
    pressures = _pressures(ctx)

    summary = f"Apply the vendor patch for {cve} on {asset}."
    if fix_type == "config":
        summary = f"Apply a configuration change or compensating control for {cve} on {asset}."
    elif fix_type == "iac":
        summary = f"Update the infrastructure-as-code definition to a patched version for {cve} on {asset}."
    if pressures:
        summary += " This finding is " + ", ".join(pressures) + "."
    summary += " " + _urgency(score)
    if ctx.get("internet_facing"):
        summary += (" If patching is delayed, restrict inbound exposure or apply a virtual patch "
                    "as a compensating control in the meantime.")

    bits = [f"Risk score {round(score)}/100"]
    detail = []
    if ctx.get("cvss") is not None:
        detail.append(f"CVSS {ctx['cvss']}")
    if ctx.get("epss") is not None:
        detail.append(f"EPSS {round((ctx['epss'] or 0) * 100, 1)}%")
    if detail:
        bits.append("(" + ", ".join(detail) + ")")
    rationale = " ".join(bits) + "."
    if pressures:
        rationale += " This finding is " + ", ".join(pressures) + "."
    rationale += (f" Remediating it removes the highest-weighted risk signals and reduces "
                  f"{asset}'s exposure.")

    return {
        "fix_type": fix_type,
        "title": f"Remediate {cve} on {asset}",
        "summary": summary,
        "fix_artifact": _artifact(fix_type, cve, asset, ctx.get("os_family")),
        "rationale": rationale,
        "rollback_plan": rollback_for(fix_type),
        "source": "heuristic",
    }


# ─── AI plan, with the heuristic as the floor ───────────────────────────────

_SYSTEM = (
    "You are a senior vulnerability remediation engineer. Given a finding's context, "
    "produce a concrete remediation plan. Respond with a single JSON object with the keys "
    "fixType, title, summary, fixArtifact, rationale. fixType must be one of "
    "patch, script, iac, config. fixArtifact must be concrete, copy-pasteable steps or a "
    "script — no placeholders where a real value is knowable. Return ONLY the JSON object, "
    "no prose and no code fences."
)


def generate_plan(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Try the AI; fall back to the heuristic on any doubt whatsoever."""
    base = heuristic_plan(ctx)
    try:
        from grc.services.ai_client import get_chat_completion  # type: ignore
    except Exception:
        return base

    try:
        raw = get_chat_completion(
            system=_SYSTEM,
            user="Finding context:\n" + json.dumps(ctx, indent=2, default=str),
            max_tokens=2048,
            json_mode=True,
        )
        payload = json.loads(raw)
    except Exception as exc:  # noqa: BLE001 — any failure means heuristic
        logger.info("remediation AI unavailable, using heuristic plan: %s", exc)
        return base

    # Every field must be present and non-empty, or we keep the heuristic.
    required = ("title", "summary", "fixArtifact", "rationale")
    if not all(str(payload.get(k) or "").strip() for k in required):
        logger.info("remediation AI returned an incomplete plan, using heuristic")
        return base

    fix_type = payload.get("fixType")
    if fix_type not in VALID_FIX_TYPES:
        fix_type = base["fix_type"]

    return {
        "fix_type": fix_type,
        "title": str(payload["title"])[:255],
        "summary": str(payload["summary"]),
        "fix_artifact": str(payload["fixArtifact"]),
        "rationale": str(payload["rationale"]),
        "rollback_plan": rollback_for(fix_type),
        "source": "ai",
    }
