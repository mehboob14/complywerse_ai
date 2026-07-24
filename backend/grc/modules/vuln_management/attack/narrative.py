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

from . import catalog

logger = logging.getLogger(__name__)

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

SYSTEM_PROMPT = """You are a red-team analyst writing a short attacker walkthrough for a defender reading a GRC \
tool. For ONE weakness on ONE asset, tell the STORY of what an attacker DOES, stage by stage.

You are given a pre-computed assessment: the weakness (CWE), the asset, and an ordered MITRE ATT&CK chain where each \
technique carries WHAT IT IS, a STATUS (likely / possible / blocked), and the reason. You did not compute any of this \
and must not second-guess it.

Write it as an ATTACKER'S STORY, never as a description of the assessment:
- For each stage, describe what the attacker concretely DOES — the action, what they target, what they are trying to \
achieve — grounded in that technique's "what it is" and in the weakness. LEAD WITH THE ACTION.
- Then fold reachability into the SAME sentence: if the step is LIKELY, name the evidence that makes it work (a \
verified or public exploit, a KEV listing); if BLOCKED, name the concrete fact that stops them (not internet-exposed, \
a local-only attack vector, the fix is applied); if POSSIBLE, say the door is open but nothing yet confirms they walk \
through it. The status COLOURS the sentence — it is never the subject of it.

Concrete but not fabricated — this is the line you must not cross:
- DESCRIBE the KIND of action the technique + weakness entail, in plain attacker terms. GOOD: "The attacker feeds \
crafted ../ sequences to the app, trying to climb out of the web root and read files the server should never expose." \
GOOD: "Using the SQL-injection flaw, the attacker rewrites the query to dump the user table."
- DO NOT invent environment specifics as if they were observed — no made-up IP addresses, hostnames, usernames, \
filenames, ports, or timelines presented as real. The weakness CLASS is real; a specific stolen file at 03:00 from \
10.0.0.5 is a fabrication. Describe the technique, don't script a fake incident.

BANNED — you are narrating the attack, not the tool. NEVER write "this step is marked as…", "this step is possible", \
"the earlier steps hold", "it is not / hasn't been confirmed exploited in the wild", "mapped via…", "STATUS=", or any \
phrase about the assessment itself. The defender can already see the badges; your job is the story behind them. For a \
POSSIBLE step, describe the avenue the attacker WOULD try and say plainly that nothing yet proves they have used it \
here — do not narrate the word "possible".

Chain rules:
- Use ONLY the techniques given, in the given order. Never invent a technique, CVE, or tool that is not in the data.
- Initial Access and Execution are ALTERNATIVE ways in — a blocked one does not end the attack if another entry step \
is likely or possible; say which door is open.
- Do NOT author an overall verdict or say whether the attack ultimately succeeds. The engine owns that and the tool \
shows it beside your walkthrough. NEVER call the attack "thwarted", "stopped", "prevented", or the target "safe" when \
an entry step is likely or possible — a blocked step closes one door, not the attack.

End with ONE line: the single most useful defensive action (the remediation) — no verdict line.
Then a FINAL separate line that reports the ENGINE'S finding (given to you as "Engine finding"): exactly \
`SELFCHECK: reachable` if that finding is likely or possible, or `SELFCHECK: blocked` if it is unlikely. It is \
validated then removed before display — it must match the engine finding, not your own read of the steps.

Format: a one-sentence scene-setter (the attacker's goal on this asset), then one short paragraph per stage prefixed \
with the tactic in bold (e.g. **Initial Access —**), then the defensive-action line, then the SELFCHECK line. Tight \
and concrete — every sentence is something the attacker does."""


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

# Any SELFCHECK/VERDICT line the model emits is machine-only and stripped before
# display. The token is normalised: the model is asked for reachable/blocked but
# sometimes echoes the verdict word (likely/possible/unlikely) — accept both so a
# stray token neither leaks to the screen nor misfires the gate.
_MACHINE_LINE = re.compile(r"^\s*(?:SELFCHECK\s*:\s*(\w+)|VERDICT\s*:.*)\s*$", re.I)
_REACHABLE_TOKENS = {"reachable", "likely", "possible", "yes", "true"}
_BLOCKED_TOKENS = {"blocked", "unlikely", "severed", "no", "false"}


def _strip_machine_lines(text: str) -> Tuple[Optional[str], str]:
    """Pull the SELFCHECK value out (normalised to reachable/blocked) and drop every
    machine-only line (SELFCHECK + any stray VERDICT line) from what we display."""
    selfcheck: Optional[str] = None
    kept = []
    for line in text.splitlines():
        m = _MACHINE_LINE.match(line)
        if m:
            tok = (m.group(1) or "").lower()
            if tok in _REACHABLE_TOKENS:
                selfcheck = "reachable"
            elif tok in _BLOCKED_TOKENS:
                selfcheck = "blocked"
            continue  # drop SELFCHECK / stray VERDICT lines from the display
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


# Human labels for the weakness classes — so the narrator can ground the attacker's
# actions in the actual flaw (CWE-22 → "escape the web root") instead of echoing a
# number. Unmapped CWEs fall through to the bare id; the model knows the common ones.
CWE_NAMES = {
    "CWE-306": "Authentication Bypass", "CWE-287": "Improper Authentication", "CWE-862": "Missing Authorization",
    "CWE-94": "Code Injection", "CWE-89": "SQL Injection", "CWE-79": "Cross-Site Scripting",
    "CWE-22": "Path Traversal", "CWE-918": "Server-Side Request Forgery", "CWE-200": "Information Disclosure",
    "CWE-269": "Privilege Escalation", "CWE-502": "Insecure Deserialization", "CWE-352": "Cross-Site Request Forgery",
    "CWE-798": "Hard-coded Credentials", "CWE-78": "OS Command Injection", "CWE-77": "Command Injection",
    "CWE-434": "Unrestricted File Upload", "CWE-327": "Weak Cryptography", "CWE-120": "Buffer Overflow",
    "CWE-787": "Out-of-bounds Write", "CWE-119": "Memory Corruption", "CWE-20": "Improper Input Validation",
}


def _weakness_label(cwe: Optional[str]) -> Optional[str]:
    if not cwe:
        return None
    name = CWE_NAMES.get(cwe)
    return f"{name} ({cwe})" if name else cwe


def _technique_gist(technique_id: str) -> str:
    """A one-sentence "what it is" for a technique, from the ATT&CK catalogue — the
    material the narrator needs to describe a concrete attacker action rather than
    restate the badge. Trimmed to the first sentence so the prompt stays compact."""
    tech = catalog.get_technique(technique_id)
    desc = ((tech or {}).get("description") or "").strip()
    if not desc:
        return ""
    first = desc.split("\n", 1)[0].strip()
    if len(first) > 260:
        cut = first[:260]
        dot = cut.rfind(". ")
        first = cut[:dot + 1] if dot > 60 else cut.rstrip() + "…"
    return first


def _assessment_facts(view: dict) -> str:
    """Distil the build_view payload into the fact sheet the model narrates from —
    now carrying the WEAKNESS and each technique's "what it is", the raw material a
    real attacker story needs (without it, the model can only restate the status).
    The engine verdict rides along for SELFCHECK only; the model is told not to
    restate it in prose.
    """
    ev = view.get("evidence", {}) or {}
    asset = view.get("asset", {}) or {}
    weakness = _weakness_label(view.get("cwe_id"))
    lines = [
        f"Weakness: {weakness or 'unknown'}",
        f"CVE: {view.get('cve_id')}",
        f"Asset: {asset.get('name')} (internet_facing={asset.get('internet_facing')}, "
        f"criticality={asset.get('criticality')})",
        f"Other linked assets not covered by this verdict: {len(view.get('other_assets') or [])}",
        "Public-exploit evidence: "
        f"source={ev.get('exploit_source')!r}, verified_exploit={ev.get('exploit_verified')}, "
        f"kev={ev.get('kev')}, epss={ev.get('epss')}",
        f"Remediation: {view.get('remediation', {}).get('line')}",
        f"Engine finding (do NOT restate in prose — use ONLY to set the SELFCHECK line): "
        f"{view.get('verdict', {}).get('verdict')}",
        "",
        "ATTACK CHAIN (in order — narrate exactly these, no more; describe the ACTION, "
        "let the reachability only colour it):",
    ]
    for t in view.get("chain", []):
        assumed = " [mapping assumed / unproven]" if t.get("assumed") else ""
        gist = _technique_gist(t.get("technique_id", ""))
        status = (t.get("status") or "").lower()
        lines.append(f"- {(t.get('tactic_name') or t.get('tactic'))}: {t.get('technique_id')} {t.get('name')}{assumed}")
        if gist:
            lines.append(f"    what it is: {gist}")
        # The engine's "why" for POSSIBLE is generic boilerplate ("earlier steps
        # hold; not confirmed exploited in the wild") — passing it verbatim is what
        # leaks assessment-voice into the story. Give a clean cue instead; keep the
        # specific, informative reasons for LIKELY (the exploit) and BLOCKED (the fact).
        if status == "possible":
            reach = "POSSIBLE — nothing blocks this step; no exploit or KEV confirms the attacker uses it here (an open, unproven avenue)"
        else:
            reach = f"{status.upper()} — {t.get('why')}"
        lines.append(f"    reachability on this asset: {reach}")
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
