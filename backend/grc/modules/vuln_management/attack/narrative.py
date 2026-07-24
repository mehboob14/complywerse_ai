"""AI attacker-walkthrough narration — the layer that reads the computed
assessment and tells the defender, in words, what an attacker would do at each
stage.

This is the AI-on-top layer. It does NOT decide anything: the engine already
computed which techniques apply, whether each is reachable, and why. The model's
only job is to turn those rows into a readable, stage-by-stage attacker story —
grounded so it can't invent a path the engine didn't find. That grounding is the
whole point: an ungrounded model would confidently narrate nine attack stages
when the evidence supports one (the "reassuring lie" this build refuses).

One invariant matters above the rest: **the narration must never contradict the
engine's verdict.** The first real render produced exactly that failure — the
model concluded "the attack is likely thwarted" while the engine badge on the same
screen said "Likely to be exploitable." Every other invariant in this engine is
enforced structurally (ENTRY_TACTICS imported from one place, REMEDIATED_STATUSES
shared, fail-loud tripwires); this one must be too, not left to the prompt. So:

  * the model does NOT author a verdict at all — the engine owns it and the UI
    renders it beside the walkthrough (it can't contradict what it doesn't write);
  * the model emits a machine-checkable ``SELFCHECK`` token, and a post-generation
    gate (``_consistency_error``) validates the narration against the engine
    verdict. Mismatch → regenerate once with a correction → still mismatch → return
    the chain-only fallback. A contradiction never reaches the screen. This is the
    same degradation path already used for a model/key failure, for a new failure.

Input: the ``build_view`` payload (chain + verdict + evidence + remediation).
Output: a narration the tab renders, or ``{narrative: None, error}`` — never a
fabricated story and never one that disagrees with the engine.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

SYSTEM_PROMPT = """You are a security analyst writing for a defender who is reading a GRC tool. \
You narrate how an attacker could (or could not) exploit ONE specific vulnerability on ONE specific asset.

You are given a PRE-COMPUTED assessment: an ordered MITRE ATT&CK attack chain where every technique already \
carries a status (likely / possible / blocked) and the reason for that status, plus the overall verdict, the \
public-exploit evidence, and the remediation. You did not compute any of this and you must not second-guess it.

HARD RULES — follow every one:
- Use ONLY the techniques, statuses, reasons and evidence provided. Never invent a technique, CVE, tool, \
capability, or step that is not in the data. If it is not in the assessment, it does not exist.
- Walk the chain in the given order, one stage at a time. For each technique say, in plain language, what the \
attacker would attempt, and then state whether it is likely / possible / blocked and WHY, using the provided reason.
- If a technique is BLOCKED, say that specific path is closed and why. But a blocked step does NOT by itself end \
the attack. Initial Access and Execution are ALTERNATIVE ways in — exploiting an internet-facing service (Initial \
Access) versus a client-side exploit via a malicious file (Execution) are different doors, not one sequence. So when \
one entry technique is blocked while another is still likely or possible, the attacker DOES have a way in — narrate \
it, do not declare the attack over.
- Do NOT author an overall verdict, and do NOT say whether the attack ultimately succeeds or fails. The engine \
already computed the verdict and the tool shows it right beside your walkthrough; your job is the STAGES, not the \
judgment. In particular NEVER write that the attack is "thwarted", "stopped", or "prevented", that the attacker \
"cannot proceed", or that the target is "safe" / "not exploitable" — a blocked step closes one door, not the attack.
- Ground confidence in the evidence: if a verified public exploit or a CISA-KEV listing is present, say so plainly \
as the reason a step is likely. If the attack vector or CWE is missing (an "assumed" mapping), say the reachability \
is unproven rather than asserting it.
- Honest and concrete, not dramatic. No fear-mongering, no filler, no invented specifics (no fake IPs, payloads, \
timelines). A defender should trust every sentence because it traces to the data.
- End with ONE line: the single most useful defensive action (the remediation). Do not add a verdict line.
- Then, on a FINAL separate line, output exactly one machine-check token — `SELFCHECK: reachable` if at least one \
step in the chain is a viable way in (any step is likely or possible), or `SELFCHECK: blocked` if every step is \
blocked. This line is validated and then removed before display; it must reflect the chain you were given.

Format: a short intro sentence, then one short paragraph per stage prefixed with the tactic name in bold \
(e.g. **Initial Access —**), then the one defensive-action line, then the SELFCHECK line. Keep it tight."""


# ── verdict-consistency gate ────────────────────────────────────────────────
# The narration must never contradict the engine verdict. Enforced here, not by
# the prompt. Verdicts that mean "a way in exists" vs "no entry path".
_REACHABLE_VERDICTS = {"likely", "possible"}

# CONCLUSION phrases that assert the attack as a whole fails / there is no way in.
# Deliberately NOT per-step language: "this step is blocked" / "this path is
# closed" are legitimate and absent here, so honest per-step narration never trips
# the gate. This is a heuristic tripwire (like the fail-loud guards elsewhere): it
# fails SAFE — a false positive just falls back to the honest chain-only card.
_ATTACK_FAILS_PHRASES = (
    "cannot proceed further", "unable to proceed", "cannot proceed with the attack",
    "attack is thwarted", "likely thwarted", "attack thwarted", "is thwarted",
    "attack is stopped", "attacker is stopped", "attack is prevented", "attack fails",
    "attack would fail", "not exploitable", "cannot be exploited", "no way in",
    "no viable path", "no path to exploit", "unlikely to succeed", "will not succeed",
    "cannot succeed", "fully mitigated", "fully protected", "completely blocked",
    "unable to gain access", "cannot gain access", "attacker cannot get in",
    "no successful path", "target is safe", "asset is safe",
)
# CONCLUSION phrases that assert the attack succeeds — the contradiction when the
# engine found NO entry path (verdict unlikely).
_ATTACK_SUCCEEDS_PHRASES = (
    "attack succeeds", "attack will succeed", "likely to succeed", "successfully gains access",
    "gains full access", "attacker gets in", "there is a way in", "at least one way in",
    "is exploitable",
)

_MACHINE_LINE = re.compile(r"^\s*(?:SELFCHECK\s*:\s*(reachable|blocked)|VERDICT\s*:.*)\s*$", re.I)


def _strip_machine_lines(text: str) -> Tuple[Optional[str], str]:
    """Pull the SELFCHECK value out and drop any machine-only lines (SELFCHECK and
    any stray VERDICT line the model shouldn't have written) from what we display.
    Returns (selfcheck_value_or_None, cleaned_text)."""
    selfcheck: Optional[str] = None
    kept = []
    for line in text.splitlines():
        m = _MACHINE_LINE.match(line)
        if m:
            if m.group(1):
                selfcheck = m.group(1).lower()
            continue  # drop SELFCHECK and stray VERDICT lines from the display
        kept.append(line)
    return selfcheck, "\n".join(kept).strip()


def _conclusion_contradiction(narrative: str, verdict: str) -> Optional[str]:
    """Return the offending conclusion phrase if the prose contradicts the verdict
    direction, else None."""
    low = narrative.lower()
    if verdict in _REACHABLE_VERDICTS:
        return next((p for p in _ATTACK_FAILS_PHRASES if p in low), None)
    if verdict == "unlikely":
        return next((p for p in _ATTACK_SUCCEEDS_PHRASES if p in low), None)
    return None


def _consistency_error(narrative: str, verdict: Optional[str], selfcheck: Optional[str]) -> Optional[str]:
    """None if the narration is consistent with the engine verdict, else a short
    reason. Two independent checks: the model's own SELFCHECK token must match the
    verdict direction, AND the prose must carry no conclusion that contradicts it."""
    if not narrative or not verdict:
        return None
    v = verdict.lower()
    expected = "reachable" if v in _REACHABLE_VERDICTS else ("blocked" if v == "unlikely" else None)
    if selfcheck and expected and selfcheck != expected:
        return f"selfcheck={selfcheck!r} but verdict={v!r} expects {expected!r}"
    phrase = _conclusion_contradiction(narrative, v)
    if phrase:
        return f"conclusion {phrase!r} contradicts verdict={v!r}"
    return None


def _assessment_facts(view: dict) -> str:
    """Distil the build_view payload into the compact fact sheet the model reads.
    Only what it's allowed to narrate from — nothing extra to hallucinate around.
    """
    ev = view.get("evidence", {}) or {}
    lines = [
        f"CVE: {view.get('cve_id')}",
        f"Asset: {view.get('asset', {}).get('name')} "
        f"(internet_facing={view.get('asset', {}).get('internet_facing')}, "
        f"criticality={view.get('asset', {}).get('criticality')})",
        f"Other linked assets not covered by this verdict: {len(view.get('other_assets') or [])}",
        f"VERDICT: {view.get('verdict', {}).get('verdict')} — {view.get('verdict', {}).get('verdict_reason')}",
        f"Signals present: {view.get('verdict', {}).get('signal_pct')}%  "
        f"Data completeness: {view.get('verdict', {}).get('data_completeness')}%",
        "Public-exploit evidence: "
        f"source={ev.get('exploit_source')!r}, verified_exploit={ev.get('exploit_verified')}, "
        f"kev={ev.get('kev')}, epss={ev.get('epss')}",
        f"Remediation: {view.get('remediation', {}).get('line')}",
        "",
        "ATTACK CHAIN (in order — narrate exactly these, no more):",
    ]
    for t in view.get("chain", []):
        prov = t.get("mapping_source")
        assumed = " [assumed/unproven mapping]" if t.get("assumed") else ""
        mits = ", ".join(m.get("id") for m in (t.get("mitigations") or [])[:4])
        lines.append(
            f"- [{(t.get('tactic_name') or t.get('tactic'))}] {t.get('technique_id')} {t.get('name')} "
            f"=> STATUS={t.get('status', '').upper()}. Reason: {t.get('why')} "
            f"(mapped via {prov}{assumed}; mitigations: {mits or 'none listed'})"
        )
    return "\n".join(lines)


def _call_model(client, model: str, temperature: float, facts: str, corrective: Optional[str]) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "Here is the pre-computed assessment. Narrate the attacker "
                                    "walkthrough, following every rule.\n\n" + facts},
    ]
    if corrective:
        messages.append({"role": "system", "content": corrective})
    resp = client.chat.completions.create(model=model, temperature=temperature, messages=messages)
    return (resp.choices[0].message.content or "").strip()


def narrate_attack_path(view: dict, *, api_key: Optional[str] = None,
                        model: Optional[str] = None, temperature: float = 0.0,
                        client: Optional[object] = None) -> dict:
    """Generate the grounded attacker walkthrough for one assessment.

    Returns ``{"narrative": str, "model": str, "consistency_checked": True, ...}``
    on success, or ``{"narrative": None, "error": str}`` on any failure — including
    ``error="verdict_inconsistent"`` when the model twice produced a narration that
    contradicted the engine verdict (we withhold it rather than show a contradiction).
    Never a fabricated story, never one that disagrees with the engine.

    ``client`` is an injection seam for tests (a stub OpenAI-shaped client); in
    production it is constructed from the key.
    """
    key = api_key or os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not key and client is None:
        return {"narrative": None, "error": "no_api_key"}
    facts = _assessment_facts(view)
    verdict = (view.get("verdict", {}) or {}).get("verdict")
    grounded_on = {
        "verdict": verdict,
        "technique_count": len(view.get("chain", [])),
        "cve_id": view.get("cve_id"),
    }
    try:
        if client is None:
            from openai import OpenAI
            client = OpenAI(api_key=key)
        mdl = model or MODEL
        corrective: Optional[str] = None
        last_err: Optional[str] = None
        # Generate, then AT MOST one corrective retry. The verdict-consistency gate
        # runs on each attempt; a contradiction is never returned.
        for attempt in range(2):
            raw = _call_model(client, mdl, temperature, facts, corrective)
            selfcheck, text = _strip_machine_lines(raw)
            err = _consistency_error(text, verdict, selfcheck)
            if not err:
                return {
                    "narrative": text or None,
                    "model": mdl,
                    "consistency_checked": True,
                    "regenerated": attempt > 0,
                    "grounded_on": grounded_on,
                }
            last_err = err
            logger.warning("attack narration contradicted the engine verdict (attempt %d/2): %s",
                           attempt + 1, err)
            corrective = (
                f"Your previous draft contradicted the engine verdict ({err}). The engine verdict is "
                f"authoritative and is {verdict!r}. Re-narrate the stages and name which step is the way in; "
                f"do NOT conclude the attack fails, is thwarted, or that the attacker is stopped when the "
                f"verdict is likely or possible. Emit the correct SELFCHECK line."
            )
        # Both attempts contradicted the engine — refuse to display a contradiction.
        # Degrade to the chain-only card, exactly like a model/key failure.
        logger.error("attack narration failed verdict-consistency twice; withholding it: %s", last_err)
        return {"narrative": None, "error": "verdict_inconsistent", "detail": last_err,
                "verdict": verdict}
    except Exception as exc:  # noqa: BLE001 — narration must never break the tab
        logger.exception("attack-path narration failed: %s", exc)
        return {"narrative": None, "error": f"{type(exc).__name__}: {str(exc)[:160]}"}
