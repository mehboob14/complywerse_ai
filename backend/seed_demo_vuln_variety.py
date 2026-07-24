"""Reversible DEMO enrichment: give the 15 [DEMO] vulnerability findings a realistic,
VARIED CWE + CVSS-vector spread so the ATT&CK engine produces a different attack
chain (and the AI walkthrough a different story) per finding instead of the same
assumed-generic chain fifteen times.

These are synthetic findings with fabricated CVE IDs (CVE-2024-2001..2015), so NVD
enrichment can't populate them — this fills CWE + vector directly. In-place and
non-destructive: keeps the existing rows/ids and the ExploitDB backfill; reversible.

The spread is deliberate — 5 likely / 5 possible / 5 remediated-unlikely, 15 distinct
weakness classes, a mix of network/local vectors and user-interaction, and a few with
public exploits / KEV so LIKELY entry badges and verified-exploit chips appear:

Usage (from backend/):  python seed_demo_vuln_variety.py apply|reset [--tenant complyverse]
"""
import argparse
import sys

from grc.db import open_tenant_session
from grc.models import Vulnerability

# cve -> (cwe, cvss_vector, cvss_score, kev, public_exploit_count, exploitdb_verified, exploit_source)
# exploit_source None means "leave the public-exploit fields as they are".
SPREAD = {
    "CVE-2024-2001": ("CWE-306", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8, False, 0, 0, None),   # auth bypass (patched)
    "CVE-2024-2002": ("CWE-94",  "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.1, False, 0, 0, None),   # code injection (patched)
    "CVE-2024-2003": ("CWE-89",  "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N", 8.2, False, 3, 2, "github; exploit-db (verified)"),  # SQLi, internet-facing + verified exploit ⭐
    "CVE-2024-2004": ("CWE-79",  "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:L/A:N", 7.5, False, 0, 0, None),   # XSS (patched)
    "CVE-2024-2005": ("CWE-22",  "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", 7.1, False, 0, 0, None),   # path traversal
    "CVE-2024-2006": ("CWE-918", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N", 6.4, True,  0, 0, None),   # SSRF, internet-facing + KEV ⭐
    "CVE-2024-2007": ("CWE-200", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", 5.5, False, 0, 0, None),   # info disclosure (patched)
    "CVE-2024-2008": ("CWE-269", "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", 7.8, False, 0, 0, None),   # local privesc (AV:L)
    "CVE-2024-2009": ("CWE-502", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 8.8, False, 2, 0, "github"),  # deserialization RCE, internet-facing + exploit ⭐
    "CVE-2024-2010": ("CWE-352", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N", 3.2, False, 0, 0, None),   # CSRF (UI:R)
    "CVE-2024-2011": ("CWE-798", "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", 9.5, False, 0, 0, None),   # hardcoded creds (AV:L, accepted)
    "CVE-2024-2012": ("CWE-78",  "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 7.9, False, 0, 0, None),   # OS command injection, internet-facing (accepted)
    "CVE-2024-2013": ("CWE-434", "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", 6.0, False, 1, 0, "github"),  # unrestricted upload + exploit ⭐
    "CVE-2024-2014": ("CWE-327", "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N", 2.4, False, 0, 0, None),   # weak crypto (patched)
    "CVE-2024-2015": ("CWE-120", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 7.7, False, 1, 0, "github"),  # buffer overflow + exploit
}


def apply(db):
    n = 0
    for cve, (cwe, vec, score, kev, pub, edb_ver, src) in SPREAD.items():
        v = db.query(Vulnerability).filter(Vulnerability.cve_id == cve).first()
        if not v:
            continue
        v.cwe_id = cwe
        v.cvss_vector = vec
        v.cvss_score = score
        v.kev_flag = kev
        if src is not None:
            v.public_exploit_count = pub
            v.exploitdb_count = edb_ver          # verified entries also count as present
            v.exploitdb_verified_count = edb_ver
            v.exploit_source = src
        n += 1
    db.commit()
    return n


def reset(db):
    n = 0
    for cve in SPREAD:
        v = db.query(Vulnerability).filter(Vulnerability.cve_id == cve).first()
        if not v:
            continue
        v.cwe_id = None
        v.cvss_vector = None
        v.exploit_source = None
        n += 1
    db.commit()
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["apply", "reset"])
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        count = apply(db) if args.command == "apply" else reset(db)
        print(f"{args.command}: {count} findings updated on tenant {args.tenant}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
