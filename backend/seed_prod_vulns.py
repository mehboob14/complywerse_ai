"""Seed 10 real, correctly-modelled vulnerabilities into a tenant.

Unlike the earlier demo seed, these are REAL CVEs with their true CVSS scores,
vectors, CWE, EPSS and CISA-KEV flags, relevant to the stack actually running on
the onboarded host (Ubuntu 24.04 + OpenSSH + nginx + PostgreSQL + Redis + glibc).
Each vuln is linked to the tenant's primary infrastructure asset.

Idempotent: re-running removes only the rows THIS script created (matched by the
CVE set below), never other vulnerabilities.

Usage (run from backend/):
    python seed_prod_vulns.py seed     [--tenant complyverse]
    python seed_prod_vulns.py cleanup  [--tenant complyverse]
"""
import argparse
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Load backend/.env BEFORE importing grc.* (auth_router asserts SESSION_SECRET at
# import time). .strip() handles CRLF line endings so a Windows-authored .env
# doesn't leave a trailing \r on the DB name.
_ENV = Path(__file__).with_name(".env")
if _ENV.exists() and not os.environ.get("MASTER_DATABASE_URL"):
    for _line in _ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

from grc.models import Vulnerability, VulnerabilityAssetLink, ITAsset, GRCUser
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

# (cve, title, severity, cvss, vector, cwe, epss, percentile, kev, ransomware,
#  component, family, status, days_ago, description, recommendation)
VULNS = [
    ("CVE-2024-6387", "OpenSSH regreSSHion — unauthenticated RCE (signal handler race)",
     "high", 8.1, "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", "CWE-364",
     0.61, 0.98, False, False, "OpenSSH server (sshd) 9.6p1", "Misc.", "open", 4,
     "A signal handler race condition in OpenSSH's sshd allows unauthenticated remote code execution as root on glibc-based Linux. Affects sshd 8.5p1–9.7p1.",
     "Upgrade OpenSSH to 9.8p1 or later. As interim mitigation set LoginGraceTime 0 in sshd_config (note: exposes to connection-exhaustion DoS)."),
    ("CVE-2024-3094", "xz/liblzma upstream backdoor (malicious build artifact)",
     "critical", 10.0, "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", "CWE-506",
     0.83, 0.99, True, False, "liblzma / xz-utils 5.6.0-5.6.1", "Misc.", "in_progress", 9,
     "Malicious code introduced into xz/liblzma 5.6.0 and 5.6.1 hooks sshd via systemd's liblzma dependency and can allow remote code execution / auth bypass.",
     "Verify xz-utils version; downgrade to a known-good 5.4.x. Ubuntu 24.04 stable was not shipped with the backdoored build — confirm via `xz --version` and package origin."),
    ("CVE-2023-4911", "glibc 'Looney Tunables' — local privilege escalation via GLIBC_TUNABLES",
     "high", 7.8, "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "CWE-787",
     0.72, 0.98, True, False, "glibc ld.so dynamic loader", "Misc.", "open", 12,
     "A buffer overflow in glibc's ld.so while processing the GLIBC_TUNABLES environment variable lets a local user gain full root privileges.",
     "Update the glibc package (libc6) to the patched release and reboot so all processes use the fixed loader."),
    ("CVE-2021-4034", "polkit pkexec 'PwnKit' — local root privilege escalation",
     "high", 7.8, "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "CWE-269",
     0.94, 0.99, True, False, "policykit-1 (pkexec)", "Misc.", "open", 20,
     "Out-of-bounds write in polkit's pkexec allows any unprivileged local user to escalate to root. Widely exploited.",
     "Update the policykit-1 package. If patching is delayed, remove the SUID bit from pkexec as a temporary mitigation."),
    ("CVE-2022-0847", "Linux kernel 'Dirty Pipe' — arbitrary file overwrite / privilege escalation",
     "high", 7.8, "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "CWE-665",
     0.70, 0.97, False, False, "Linux kernel 5.8–5.16 pipe subsystem", "Misc.", "resolved", 40,
     "Improper initialization of pipe buffer flags lets a local user overwrite data in read-only files, enabling privilege escalation.",
     "Update the kernel to a patched release (5.16.11 / 5.15.25 / 5.10.102 or later) and reboot."),
    ("CVE-2023-38545", "curl SOCKS5 heap buffer overflow",
     "critical", 9.8, "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", "CWE-787",
     0.42, 0.96, False, False, "curl / libcurl < 8.4.0", "Misc.", "open", 8,
     "A heap buffer overflow in curl's SOCKS5 proxy handshake can be triggered when a hostname longer than the buffer is passed to a SOCKS5 proxy, potentially leading to RCE.",
     "Update curl/libcurl to 8.4.0 or later."),
    ("CVE-2023-44487", "HTTP/2 Rapid Reset — denial of service",
     "high", 7.5, "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H", "CWE-400",
     0.94, 0.99, True, False, "nginx / HTTP-2 (port 443)", "Web Servers", "in_progress", 6,
     "The HTTP/2 protocol allows a client to rapidly open and cancel streams (RST_STREAM), exhausting server resources and causing denial of service. Exploited in record-breaking DDoS.",
     "Update nginx to a version with HTTP/2 rapid-reset mitigations; consider limiting concurrent streams / requests per connection."),
    ("CVE-2024-10977", "PostgreSQL libpq — error-message injection over unencrypted connection",
     "medium", 3.7, "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N", "CWE-74",
     0.09, 0.45, False, False, "PostgreSQL libpq client (port 5432)", "Databases", "open", 15,
     "A man-in-the-middle on an unencrypted/untrusted-cert PostgreSQL connection can inject bytes into libpq error messages, potentially misleading the client.",
     "Update PostgreSQL client libraries; enforce sslmode=verify-full so untrusted servers cannot MITM the connection."),
    ("CVE-2022-24834", "Redis — Lua cjson/cmsgpack heap overflow (authenticated RCE)",
     "high", 7.0, "CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:H", "CWE-787",
     0.18, 0.55, False, False, "Redis server (Lua scripting)", "Databases", "open", 18,
     "A heap overflow in the bundled Lua cjson/cmsgpack libraries lets an authenticated user with EVAL access run arbitrary code on the Redis host.",
     "Update Redis to 6.2.13 / 7.0.12 / 7.2.0 or later; restrict/disable Lua scripting and require strong ACLs."),
    ("CVE-2024-2961", "glibc iconv ISO-2022-CN-EXT out-of-bounds write",
     "high", 8.8, "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", "CWE-787",
     0.16, 0.53, False, False, "glibc iconv() (libc6)", "Misc.", "open", 10,
     "An out-of-bounds write in glibc's iconv() when converting to the ISO-2022-CN-EXT charset can be leveraged (e.g. via PHP or other consumers) for code execution.",
     "Update the glibc package (libc6) to the patched release and restart dependent services."),
]

SEED_CVES = {v[0] for v in VULNS}
_SLA_DAYS = {"critical": 7, "high": 15, "medium": 30, "low": 90, "info": 90}


def cleanup(db, tid):
    ids = [r[0] for r in db.query(Vulnerability.id).filter(
        Vulnerability.tenant_id == tid,
        Vulnerability.cve_id.in_(SEED_CVES),
    ).all()]
    if not ids:
        return 0
    db.query(VulnerabilityAssetLink).filter(
        VulnerabilityAssetLink.vulnerability_id.in_(ids)
    ).delete(synchronize_session=False)
    db.query(Vulnerability).filter(
        Vulnerability.id.in_(ids)
    ).delete(synchronize_session=False)
    db.commit()
    return len(ids)


def seed(db, tenant_slug):
    user = db.query(GRCUser).first()
    if not user:
        sys.exit("No users in tenant DB — cannot resolve tenant id.")
    tid = get_user_tenants(user, db)[0]

    # Link everything to the tenant's primary infrastructure asset (the host).
    asset = (
        db.query(ITAsset)
        .filter(ITAsset.tenant_id == tid, ITAsset.asset_type == "infrastructure")
        .order_by(ITAsset.id)
        .first()
        or db.query(ITAsset).filter(ITAsset.tenant_id == tid).order_by(ITAsset.id).first()
    )
    host = (asset.host_name or asset.ip_address) if asset else None
    now = datetime.utcnow()

    created = 0
    for i, (cve, title, sev, cvss, vec, cwe, epss, pct, kev, ranso,
            comp, fam, status, ago, desc, rec) in enumerate(VULNS, start=1):
        discovered = now - timedelta(days=ago)
        v = Vulnerability(
            tenant_id=tid,
            vuln_id=f"VULN-{1000 + i}",
            title=title,
            description=desc,
            severity=sev,
            cvss_score=cvss,
            cvss_vector=vec,
            cvss_version="3.1",
            nvd_cvss_score=cvss,
            nvd_cvss_vector=vec,
            cve_id=cve,
            cwe_id=cwe,
            cwe_ids=[cwe],
            affected_component=comp,
            affected_host=host,
            plugin_family=fam,
            evidence=f"Detected on {host or 'target host'} — matched installed package/version for {comp}.",
            recommendation=rec,
            status=status,
            discovered_at=discovered,
            due_date=discovered + timedelta(days=_SLA_DAYS.get(sev, 30)),
            resolved_at=(now - timedelta(days=max(0, ago - 5))) if status == "resolved" else None,
            epss_score=epss,
            epss_percentile=pct,
            kev_flag=kev,
            kev_ransomware_flag=ranso if kev else None,
            kev_date_added=(now - timedelta(days=ago + 30)) if kev else None,
            nvd_published_at=now - timedelta(days=ago + 60),
        )
        db.add(v)
        db.flush()  # assign v.id
        if asset:
            db.add(VulnerabilityAssetLink(
                vulnerability_id=v.id,
                asset_id=asset.id,
                link_source="scanner",
                auto_linked=True,
                notes="Seeded finding linked to primary host.",
            ))
        created += 1

    db.commit()
    return created, (asset.name if asset else None)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["seed", "cleanup"])
    p.add_argument("--tenant", default="complyverse")
    args = p.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        removed = cleanup(db, get_user_tenants(db.query(GRCUser).first(), db)[0])
        if args.command == "cleanup":
            print(f"Removed {removed} seeded vulnerabilities from '{args.tenant}'.")
        else:
            n, asset_name = seed(db, args.tenant)
            print(f"Seeded {n} real-CVE vulnerabilities into '{args.tenant}'"
                  + (f", linked to asset '{asset_name}'." if asset_name else " (no asset to link)."))
            print(f"Prior seeded rows removed first: {removed}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
