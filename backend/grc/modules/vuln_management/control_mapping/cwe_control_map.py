"""Hand-curated CWE → framework-control identifier map.

Each CWE maps to a list of ``(framework_prefix, code_pattern)`` tuples,
where:

* ``framework_prefix`` is a substring matched (case-insensitive,
  left-anchored after normalisation) against the seeded
  ``Framework.short_code``. Use the regulator name + family — e.g.
  ``"PCI"`` matches any PCI-DSS seed, ``"ISO27001"`` matches ``ISO27001-2022``
  or ``ISO-27001-2013``, ``"OWASP"`` matches any OWASP variant. We
  deliberately keep prefixes loose because each tenant seeds frameworks
  with slightly different short codes.

* ``code_pattern`` is a substring matched (case-insensitive) against the
  ``FrameworkControl.code`` column. ``"6.5.1"`` matches exactly the PCI
  sub-control; ``"A.14.2.5"`` matches the ISO 27001 control; ``"A03"``
  matches any OWASP A03:2021 control regardless of year suffix.

Coverage: CWE Top 25 plus the handful of CWEs that map cleanly to
PCI / ISO / OWASP / NIST / GDPR. ~20 entries. The empty-list lookup
returns []; vulns whose CWEs aren't in the table still get the two
catch-all rules (vuln-mgmt failure / KEV) below.

Resist the urge to add an entry without a real published crosswalk —
false positives here become audit noise that nobody wants to chase
down. When in doubt, leave it out.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

# (framework_short_code prefix, FrameworkControl.code substring)
ControlIdentifier = Tuple[str, str]


# Two always-applicable rule sets. Anyone with an open CVE-bearing vuln
# is by definition failing the org's vuln-management programme controls;
# anyone KEV-listed is by definition triggering the incident-response
# controls. These supplement the CWE-specific list, they don't replace it.
ALWAYS_APPLICABLE_VULN_MGMT: List[ControlIdentifier] = [
    # Patch / vuln-management controls — the cleanest cross-framework set.
    ("PCI", "6.3.3"),                # PCI DSS 6.3.3 — security patches
    ("PCI", "11.3"),                 # PCI DSS 11.3 — vuln assessment programme
    ("ISO27001", "A.8.8"),           # ISO/IEC 27001:2022 A.8.8 — technical vuln mgmt
    ("ISO-27001", "A.8.8"),          # alternate short-code formatting
    ("ISO27002", "8.8"),             # ISO 27002 control 8.8
    ("NIST", "RA-5"),                # NIST 800-53 RA-5 — vuln monitoring and scanning
    ("NIST", "SI-2"),                # NIST 800-53 SI-2 — flaw remediation
    # NIST CSF — precise, publisher-backed (CSF 1.1 informative refs → 800-53 RA-5):
    # ID.RA-1 "asset vulnerabilities are identified and documented" and DE.CM-8
    # "vulnerability scans are performed". Was the DE.CM family, which on an
    # upload lacking DE.CM-8 pulled in DE.CM-1/4/7 (network / malware /
    # unauthorised-activity monitoring) — not vulnerability management.
    ("NIST-CSF", "ID.RA-1"),
    ("NIST-CSF", "DE.CM-8"),
    ("NIS2", "Art.21"),              # NIS2 Article 21 — risk management measures
    ("DORA", "Art.9"),               # DORA Article 9 — protection and prevention
]

ALWAYS_APPLICABLE_ACTIVE_EXPLOITATION: List[ControlIdentifier] = [
    # Triggered only when the vuln is KEV-flagged (CISA-confirmed
    # exploitation). Active exploitation is an incident-response trigger
    # in every major framework.
    ("PCI", "12.10"),                # PCI DSS 12.10 — incident response plan
    ("ISO27001", "A.16.1"),          # ISO 27001 incident management
    ("ISO-27001", "A.16.1"),
    ("ISO27001", "A.5.24"),          # ISO 27001:2022 information security incident mgmt planning
    ("NIST", "IR-4"),                # NIST 800-53 IR-4 — incident handling
    ("NIST", "IR-6"),                # NIST 800-53 IR-6 — incident reporting
    ("DORA", "Art.17"),              # DORA Art. 17 — ICT-related incident management
]


# Main table — CWE → list of (framework_prefix, code_pattern) identifiers.
# Comments explain the published crosswalk source for each entry so a
# future reviewer can verify rather than just trust.
CWE_TO_CONTROL_IDS: Dict[str, List[ControlIdentifier]] = {
    # ── Injection family — PCI 6.5.1, OWASP A03, ISO secure dev, NIST SI-10
    "CWE-89": [   # SQL Injection
        ("PCI", "6.5.1"),
        ("ISO27001", "A.14.2.5"),
        ("ISO-27001", "A.14.2.5"),
        ("ISO27001", "A.8.28"),  # 2022 mapping for secure coding
        ("OWASP", "A03"),
        ("NIST", "SI-10"),
        ("NIST", "SI-15"),
    ],
    "CWE-77": [   # Command Injection (generic)
        ("PCI", "6.5.1"),
        ("ISO27001", "A.14.2.5"),
        ("ISO-27001", "A.14.2.5"),
        ("OWASP", "A03"),
        ("NIST", "SI-10"),
    ],
    "CWE-78": [   # OS Command Injection
        ("PCI", "6.5.1"),
        ("ISO27001", "A.14.2.5"),
        ("ISO-27001", "A.14.2.5"),
        ("OWASP", "A03"),
        ("NIST", "SI-10"),
    ],
    "CWE-94": [   # Code Injection
        ("PCI", "6.5.1"),
        ("ISO27001", "A.14.2.5"),
        ("ISO-27001", "A.14.2.5"),
        ("OWASP", "A03"),
    ],
    "CWE-79": [   # XSS
        ("PCI", "6.5.7"),
        ("ISO27001", "A.14.2.5"),
        ("ISO-27001", "A.14.2.5"),
        ("ISO27001", "A.8.28"),
        ("OWASP", "A03"),
    ],

    # ── Path / file handling
    "CWE-22": [   # Path Traversal
        ("PCI", "6.5.8"),
        ("OWASP", "A01"),
    ],
    "CWE-434": [  # Unrestricted File Upload
        ("OWASP", "A04"),
        ("OWASP", "A08"),
    ],

    # ── CSRF / state
    "CWE-352": [  # CSRF
        ("PCI", "6.5.9"),
        ("OWASP", "A05"),
    ],

    # ── Auth + authorization
    "CWE-287": [  # Improper Authentication
        ("PCI", "8.2"),
        ("PCI", "8.3"),
        ("ISO27001", "A.9.4.2"),     # 2013 numbering
        ("ISO-27001", "A.9.4.2"),
        ("ISO27001", "A.5.16"),      # 2022 identity management
        ("NIST", "IA-2"),
        ("OWASP", "A07"),
    ],
    "CWE-798": [  # Hardcoded Credentials
        ("PCI", "8.2"),
        ("OWASP", "A07"),
        ("OWASP", "A02"),
    ],
    "CWE-269": [  # Improper Privilege Management
        ("PCI", "7"),
        ("ISO27001", "A.9.2.3"),
        ("ISO-27001", "A.9.2.3"),
        ("NIST", "AC-6"),
        ("OWASP", "A01"),
    ],
    "CWE-862": [  # Missing Authorization
        ("PCI", "7.1"),
        ("ISO27001", "A.9.4.1"),
        ("ISO-27001", "A.9.4.1"),
        ("NIST", "AC-3"),
        ("OWASP", "A01"),
    ],
    "CWE-863": [  # Incorrect Authorization
        ("PCI", "7.1"),
        ("ISO27001", "A.9.4.1"),
        ("ISO-27001", "A.9.4.1"),
        ("NIST", "AC-3"),
        ("OWASP", "A01"),
    ],
    "CWE-732": [  # Incorrect Permission Assignment
        ("PCI", "7"),
        ("ISO27001", "A.9.4.1"),
        ("ISO-27001", "A.9.4.1"),
    ],

    # ── Crypto
    "CWE-311": [  # Missing Encryption of Sensitive Data
        ("PCI", "4.1"),
        ("PCI", "3.4"),
        ("ISO27001", "A.10.1.1"),
        ("ISO-27001", "A.10.1.1"),
        ("ISO27001", "A.8.24"),      # 2022 use of cryptography
        ("NIST", "SC-13"),
        ("NIST", "SC-28"),
        ("GDPR", "Art.32"),
        ("HIPAA", "164.312"),
    ],
    "CWE-326": [  # Inadequate Encryption Strength
        ("PCI", "4.1"),
        ("ISO27001", "A.10.1.1"),
        ("ISO-27001", "A.10.1.1"),
        ("ISO27001", "A.8.24"),
        ("NIST", "SC-13"),
    ],
    "CWE-327": [  # Use of a Broken / Risky Cryptographic Algorithm
        ("PCI", "4.1"),
        ("ISO27001", "A.10.1.1"),
        ("ISO-27001", "A.10.1.1"),
        ("ISO27001", "A.8.24"),
        ("NIST", "SC-13"),
    ],

    # ── Information exposure
    "CWE-200": [  # Information Exposure
        ("PCI", "3.4"),
        ("ISO27001", "A.13.2.1"),
        ("ISO-27001", "A.13.2.1"),
        ("GDPR", "Art.32"),
    ],

    # ── Deserialization / XXE / SSRF
    "CWE-502": [  # Deserialization of Untrusted Data
        ("OWASP", "A08"),
        ("PCI", "6.5"),
    ],
    "CWE-611": [  # XXE
        ("OWASP", "A05"),
        ("PCI", "6.5"),
    ],
    "CWE-918": [  # SSRF
        ("OWASP", "A10"),
        ("PCI", "6.5"),
    ],

    # ── Memory safety (legacy but still mapped)
    "CWE-119": [  # Buffer / memory bounds
        ("PCI", "6.5"),
        ("OWASP", "A03"),
    ],
    "CWE-787": [  # Out-of-bounds write — CWE Top 25 #1 typically
        ("PCI", "6.5"),
        ("OWASP", "A03"),
    ],
    "CWE-125": [  # Out-of-bounds read
        ("PCI", "6.5"),
    ],

    # ── Open redirect (lesser severity but commonly tracked)
    "CWE-601": [
        ("OWASP", "A07"),
    ],
}


def normalise_cwe(value: str) -> str:
    """Return ``CWE-NNN`` form — strips whitespace and uppercases.

    Accepts ``cwe-89``, ``CWE-89``, or just ``89`` (we add the prefix).
    Returns empty string on garbage input.
    """
    if not value:
        return ""
    s = str(value).strip().upper()
    if s.isdigit():
        return f"CWE-{s}"
    if s.startswith("CWE-") and s[4:].isdigit():
        return s
    return ""


def lookup_cwe(cwe_id: str) -> List[ControlIdentifier]:
    """Return the CWE-specific mapping list. Empty list if not in table."""
    key = normalise_cwe(cwe_id)
    if not key:
        return []
    return list(CWE_TO_CONTROL_IDS.get(key) or [])
