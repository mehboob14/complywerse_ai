"""Hand-curated CWE -> ATT&CK technique map — the gap-filler for Layer 2.

The CWE->CAPEC->ATT&CK standards chain (``capec_map``) is authoritative but
sparse: it reaches ~149 CWEs and misses the most common web-app weaknesses
outright (SQLi, XSS, command injection, deserialization). This map restores the
well-established pairs the chain drops, so a SQL-injection finding selects
``T1190`` instead of nothing.

Every entry is tagged ``mapping_source = analyst`` at read time, so the UI can
show it as a deliberate crosswalk distinct from the authoritative ``capec_chain``
and the heuristic ``cvss_derived`` rules.

Discipline — the same rule ``cwe_control_map.py`` lives by: **no entry without a
defensible, well-known crosswalk.** These are additive (unioned with CAPEC), not
overrides, so a loose guess here becomes permanent noise on every matching vuln.
When in doubt, leave it out and let the CVSS-vector rules produce a generic
entry-tactic technique instead. Memory-corruption CWEs (787/125/416/119) are
deliberately absent: their technique depends on AV/UI context, which the CVSS
rules read directly and more honestly than a fixed CWE mapping could.

Each value: (technique_id, confidence, reason). ``reason`` is shown in the
"Why this technique?" provenance and must justify the pair to a reviewer.
Technique ids are validated against the Layer 1 catalogue at load time; a typo
or a since-revoked id is dropped with a logged warning, never silently kept.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

# (technique_id, confidence {high|medium|low}, justification)
CuratedLink = Tuple[str, str, str]

CURATED_CWE_TECHNIQUES: Dict[str, List[CuratedLink]] = {
    # ── Injection: arbitrary code/command execution ────────────────────────
    "89": [  # SQL Injection
        ("T1190", "high", "SQL injection is the canonical exploitation of a public-facing application"),
    ],
    "78": [  # OS Command Injection
        ("T1059", "high", "Command injection yields arbitrary OS command execution (Command and Scripting Interpreter)"),
        ("T1190", "medium", "Typically exploited against a public-facing application"),
    ],
    "77": [  # Command Injection (generic)
        ("T1059", "high", "Command injection yields arbitrary command execution"),
    ],
    "94": [  # Code Injection
        ("T1059", "high", "Code injection yields attacker-controlled execution (Command and Scripting Interpreter)"),
    ],
    "79": [  # Cross-site Scripting
        ("T1059.007", "medium", "XSS executes attacker JavaScript in the victim's browser context"),
    ],
    "502": [  # Deserialization of Untrusted Data
        ("T1190", "high", "Insecure deserialization is a common RCE vector on public-facing services"),
    ],
    "611": [  # XML External Entity (XXE)
        ("T1190", "medium", "XXE is exploited against public-facing XML-processing endpoints"),
    ],
    "918": [  # Server-Side Request Forgery (SSRF)
        ("T1190", "medium", "SSRF abuses a public-facing app to reach and exploit internal services"),
    ],

    # ── Access / authentication weaknesses ─────────────────────────────────
    "434": [  # Unrestricted Upload of File with Dangerous Type
        ("T1505.003", "high", "Malicious file upload is the textbook path to a web shell"),
        ("T1190", "medium", "The upload endpoint is itself a public-facing application exploit"),
    ],
    "798": [  # Use of Hard-coded Credentials
        ("T1078", "high", "Hard-coded credentials are used directly as valid accounts"),
    ],
    "306": [  # Missing Authentication for Critical Function
        ("T1078", "medium", "Missing authentication grants valid-account-equivalent access"),
        ("T1190", "medium", "Commonly the unauthenticated exploitation of a public-facing function"),
    ],
    "269": [  # Improper Privilege Management
        ("T1068", "high", "Improper privilege management is the classic local privilege-escalation vector"),
    ],
}
