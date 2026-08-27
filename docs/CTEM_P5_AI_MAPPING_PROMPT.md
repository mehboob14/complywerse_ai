# P5 — AI control mapping: the exact prompt (design of record)

**Status: FINALIZED (prompt v1.4) after a 3-iteration battery against REAL
findings + the REAL control library, per user direction ("check it against
many scenarios yourself, iterate, then finalize"). Service:
`backend/grc/services/ai_control_mapping.py`. Tests:
`backend/tests/test_ai_control_mapping.py` (10, hermetic, fake model client).**

## Battery record (real findings, real gpt-4o calls, 16 Aug)

| Iter | Scenario | Result | Root cause / fix |
|---|---|---|---|
| 1 | S1 PostgreSQL CWE-1287 | ✔ Input Data Validation | — |
| 1 | S3 WinRAR heap overflow | ✔ Memory Protection + Secure Coding | — |
| 1 | S4 TLS 1.1 (no CVE) | ✔ Review Cipher Suites + Approve Protocols | — |
| 1 | S6 OS Identification | ✔ never sent (inventory) | — |
| 1 | S8 WordPad History (misbucketed) | ✔ model returned empty + "informational" | safety net works |
| 1 | **S2 WinVerifyTrust CWE-347** | ✗ NONE | shortlist built from title words → no code-signing controls offered |
| 1 | **S5 SMB Registry / S7 Print Spooler** | ✗ "informational" | prompt too conservative on hardening findings |
| 2 | S5, S7 | ✔ access-control / least-functionality | prompt: hardening ≠ inventory (rule added) |
| 2 | **S2** | ✗ still NONE | expander fired "authentication" from DESCRIPTION → MFA/password decoys flooded top-40 |
| 3 | **S2** | ✔ "Ensure authenticity and integrity of application messages" | CWE/title concepts PRIMARY, description concepts SECONDARY in ranking; CWE name (MITRE) fed to model |
| 3 | S12 Unquoted Service Path CWE-428 | ✔ System Hardening Standards | — |
| 3 | S13 Logged On Users | ✔ never sent | — |
| 3 | all regressions (S1,S4,S5,S7,S8) | ✔ | — |

**Zero invalid control ids across every iteration** — the shortlist guard held.
Classifier over all 205 real findings: 23 CVE / 52 sent / 130 inventory; the
test battery pins that no real weakness ("Unquoted Service Path", "Cannot Be
Trusted", "Cached Password"…) is ever filed as inventory. Deliberately generous
toward "send" — a spare model call is cheaper than a hidden weakness.

## Guarantees the prompt rests on (verified in code, 16 Aug)

Every fact the AI sees comes from an official authority, joined by the one
global CVE identifier — never typed, never guessed:

| Field | Source | Authority |
|---|---|---|
| CVE ID | Nessus scan (Tenable plugin DB) | Tenable / MITRE CVE |
| CWE, CVSS vector, published date | `services.nvd.nist.gov/rest/json/cves/2.0` | NIST NVD |
| EPSS | `api.first.org/data/v1/epss` | FIRST.org |
| KEV flag | `cisa.gov/…/known_exploited_vulnerabilities.json` | CISA |
| Exploit intel | Exploit-DB mirror + GitHub PoC search | public exploit DBs |
| Title / description | Nessus scan | Tenable |

Candidate controls come ONLY from the tenant's own **Unified Control Library**
(`grc_normalized_controls`, 5,290 rows) — never invented.

## Which findings go to the AI (the three buckets)

1. **Has CVE/CWE** → full context, map (≈23 today).
2. **No CVE, but description states a real weakness/misconfiguration**
   (weak TLS, open registry) → map from text, lower confidence (a handful).
3. **Inventory note** ("PostgreSQL installed", "OS identified", "logged-on
   users") → **NOT sent**; shown as "informational — no weakness to map."
   (≈175). Correct, not a gap.

Bucket 3 is decided by a cheap classifier step BEFORE the mapping call, so we
never pay for — or pollute the results with — inventory notes.

## Rules the AI must obey (baked into the prompt)

- **Suggest, never link.** Output is a proposal; a human approves each link.
- **Only from the provided candidate list.** The AI may not name a control
  that isn't in the candidates we pass. (We pre-filter the 5,290 to a
  relevant shortlist by keyword/family so the prompt stays small and the AI
  cannot hallucinate a control id.)
- **Every suggestion carries a reason** in one sentence, referencing the
  weakness — auditable, and shown to the approver.
- **Distinguish "addresses the weakness" from "generic hygiene."** The general
  patch-management controls are already linked by the rule; the AI's job is
  the SPECIFIC controls (input validation, crypto config, access hardening…).
  It must not just repeat "patch management."
- **Confidence tag** high / medium / low, and **"none" is a valid answer**: if
  no candidate genuinely addresses the weakness, say so — no forced picks.
- **Cite which input drove the pick** (CVE text / CWE class / description).
- **No fabrication:** temperature 0; JSON output; unknown = say unknown.

## The prompt (verbatim — this is what the model receives)

```
SYSTEM
You are a security-controls analyst helping a GRC team. You map ONE
vulnerability finding to the SPECIFIC security controls, drawn ONLY from the
candidate list provided, that would address the weakness it describes.

Hard rules:
- Choose ONLY from the candidate controls given (by their id). Never invent a
  control. If none genuinely addresses this weakness, return an empty list.
- The generic patch-management / vulnerability-management controls are
  ALREADY linked by rule. Do NOT suggest them again. Suggest only controls
  that address the SPECIFIC weakness (e.g. input validation, cryptographic
  configuration, least privilege, service hardening, logging/detection of
  this class of attack).
- Every suggestion must have: the candidate control id, a confidence
  (high|medium|low), a one-sentence reason that names the weakness, and
  which input drove it (cve_description | cwe | finding_description).
- Be conservative. A wrong link is worse than a missing one. Prefer 1-4 strong
  suggestions over many weak ones.
- Distinguish two kinds of no-CVE findings:
  (a) A pure INVENTORY note — a fact about the machine with nothing wrong
      (software installed, OS identified, users listed, hardware info). Return
      an empty list and say so in no_specific_control_reason.
  (b) A HARDENING weakness — something enabled, exposed, reachable, or
      configured that increases attack surface: an unnecessary service running,
      a registry/share/interface remotely accessible, a legacy protocol or weak
      cipher allowed, anonymous/null access, signing not required, a default
      left on. These ARE weaknesses. Map them to secure-configuration /
      least-functionality / hardening / access-control controls. Do NOT call
      them informational.
- Output STRICT JSON only, matching the schema. No prose, no markdown.

USER
FINDING
  title: {title}
  cve_id: {cve_id or "none"}
  cwe: {cwe_id} — {cwe_name or "unknown"}
  cvss_vector: {cvss_vector or "none"}
  severity: {severity}
  scanner_description: {description}
  cve_description (NVD): {nvd_description or "n/a"}
  epss: {epss or "n/a"}   in_kev: {true|false}
  asset_context: {asset_type}, internet_facing={true|false|unknown}

CANDIDATE CONTROLS (choose only from these ids)
  {for each candidate: id | framework | code | title | short_description}

(Verbatim SYSTEM_PROMPT + build_user_prompt live in ai_control_mapping.py;
the user prompt also carries the MITRE CWE name.)

Return JSON:
{
  "suggestions": [
    { "control_id": <int>, "confidence": "high|medium|low",
      "reason": "<one sentence naming the weakness>",
      "driven_by": "cve_description|cwe|finding_description" }
  ],
  "no_specific_control_reason": "<only if suggestions is empty>"
}
```

## Cost + safety

- Model: the platform's configured OpenAI model, temperature 0.
- ~23–30 calls for buckets 1+2 today; bucket 3 costs nothing.
- Results stored as PROPOSALS (new table) with the full prompt inputs +
  raw output, so every suggestion is auditable later.
- Approve → creates a `VulnerabilityControlLink` with
  `link_source="ai_suggested"`, `auto_linked=False`, and the approver's id.
- Reject → recorded, never re-suggested for that (finding, control) pair.
