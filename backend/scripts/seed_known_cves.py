"""Seed ~24 real, named CVE findings with distinct CWE / CVSS / attack-vector so the
Vulnerability Register + finding detail show GENUINELY DIFFERENT attack scenarios
(network RCE, local privilege-escalation, user-interaction), instead of the single
generic no-CWE chain every unclassified scanner finding collapses to.

Usage (run from the backend dir, with the app venv / python3):
    python3 scripts/seed_known_cves.py [tenant_slug]

No slug -> auto-detects the tenant that holds the liztek / ubuntu assets
(skipping *_bak_* backups). Idempotent: skips any CVE already present. Links
network vulns to an internet-facing asset and local priv-esc vulns to an internal
asset (falling back to the internet-facing one if the tenant has no internal host).
"""
import os, sys, json
from datetime import datetime, timedelta

_B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../backend
sys.path.insert(0, _B)
try:
    from dotenv import load_dotenv; load_dotenv(os.path.join(_B, ".env"))
except Exception:
    pass
from sqlalchemy import create_engine, text

TMPL = os.environ["TENANT_DB_URL_TEMPLATE"]
MASTER = os.environ.get("MASTER_DATABASE_URL")

V = 'CVSS:3.1/'
# cve, title, cwe, cvss, vector, severity, epss, kev, pub, edb, family, target('inet'|'local')
CVES = [
 ("CVE-2021-44228","Apache Log4j2 JNDI Remote Code Execution (Log4Shell)","CWE-917",10.0,V+"AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H","critical",0.975,True,45,12,"Web Servers","inet"),
 ("CVE-2014-0160","OpenSSL TLS Heartbeat Information Disclosure (Heartbleed)","CWE-125",7.5,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N","high",0.970,True,30,8,"Web Servers","inet"),
 ("CVE-2014-6271","GNU Bash Environment Variable Command Injection (Shellshock)","CWE-78",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.970,True,25,6,"CGI abuses","inet"),
 ("CVE-2017-5638","Apache Struts 2 Jakarta Multipart Parser RCE","CWE-20",10.0,V+"AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H","critical",0.975,True,20,5,"Web Servers","inet"),
 ("CVE-2018-7600","Drupal Core Remote Code Execution (Drupalgeddon2)","CWE-20",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.960,True,22,7,"CGI abuses","inet"),
 ("CVE-2019-11510","Pulse Connect Secure Arbitrary File Read","CWE-22",10.0,V+"AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H","critical",0.960,True,15,4,"Firewalls","inet"),
 ("CVE-2021-26855","Microsoft Exchange Server SSRF (ProxyLogon)","CWE-918",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.970,True,18,5,"Web Servers","inet"),
 ("CVE-2022-1388","F5 BIG-IP iControl REST Authentication Bypass","CWE-306",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.950,True,14,3,"Web Servers","inet"),
 ("CVE-2019-19781","Citrix ADC / Gateway Directory Traversal RCE","CWE-22",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.960,True,20,6,"CGI abuses","inet"),
 ("CVE-2023-34362","Progress MOVEit Transfer SQL Injection","CWE-89",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H","critical",0.940,True,8,2,"Databases","inet"),
 ("CVE-2020-14882","Oracle WebLogic Server Remote Code Execution","CWE-94",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.960,True,16,4,"Web Servers","inet"),
 ("CVE-2021-41773","Apache HTTP Server Path Traversal & RCE","CWE-22",7.5,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N","high",0.950,True,12,3,"Web Servers","inet"),
 ("CVE-2022-22965","Spring Framework Data Binding RCE (Spring4Shell)","CWE-94",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.950,True,17,4,"Web Servers","inet"),
 ("CVE-2023-4863","libwebp Heap Buffer Overflow (WebP 0-day)","CWE-787",8.8,V+"AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H","high",0.500,True,6,1,"Web Clients","inet"),
 ("CVE-2020-1938","Apache Tomcat AJP File Read/Inclusion (Ghostcat)","CWE-269",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.930,True,10,3,"Web Servers","inet"),
 ("CVE-2017-7494","Samba is_known_pipename() Remote Code Execution (SambaCry)","CWE-119",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.900,True,9,3,"Misc.","inet"),
 ("CVE-2021-22986","F5 BIG-IP iControl REST Server-Side Request Forgery","CWE-918",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H","critical",0.940,True,8,2,"Web Servers","inet"),
 ("CVE-2022-40684","Fortinet FortiOS Authentication Bypass","CWE-287",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.940,True,11,3,"Firewalls","inet"),
 ("CVE-2023-38408","OpenSSH ssh-agent PKCS#11 Remote Code Execution","CWE-426",9.8,V+"AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H","critical",0.300,False,5,1,"Misc.","inet"),
 ("CVE-2016-5195","Linux Kernel copy-on-write Privilege Escalation (Dirty COW)","CWE-362",7.8,V+"AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H","high",0.500,True,30,10,"Privilege Escalation","local"),
 ("CVE-2021-3156","Sudo Heap-Based Buffer Overflow (Baron Samedit)","CWE-787",7.8,V+"AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H","high",0.400,True,20,6,"Privilege Escalation","local"),
 ("CVE-2021-4034","polkit pkexec Local Privilege Escalation (PwnKit)","CWE-269",7.8,V+"AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H","high",0.300,True,25,8,"Privilege Escalation","local"),
 ("CVE-2022-0847","Linux Kernel pipe Privilege Escalation (Dirty Pipe)","CWE-665",7.8,V+"AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H","high",0.200,True,18,5,"Privilege Escalation","local"),
 ("CVE-2019-14287","Sudo runas ALL Security Bypass","CWE-755",8.8,V+"AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H","high",0.100,False,8,2,"Privilege Escalation","local"),
]

def detect_slug():
    if len(sys.argv) > 1:
        return sys.argv[1]
    # scan tenant DBs for the one holding the liztek/ubuntu assets, skip backups
    admin_url = MASTER or TMPL.format(slug="postgres")
    eng = create_engine(admin_url)
    with eng.connect() as c:
        dbs = [r[0] for r in c.execute(text(
            "SELECT datname FROM pg_database WHERE datname LIKE 'grc_%' "
            "AND datname NOT LIKE '%bak%' AND datname NOT LIKE '%backup%' "
            "AND datname NOT IN ('grc_master','grc_compliance_plugins') ORDER BY datname"))]
    for db in dbs:
        slug = db[len("grc_"):]
        try:
            e = create_engine(TMPL.format(slug=slug))
            with e.connect() as c:
                hit = c.execute(text("SELECT count(*) FROM grc_it_assets WHERE name ILIKE '%liztek%' OR name ILIKE '%ubuntu%'")).scalar()
            if hit:
                return slug
        except Exception:
            continue
    return "complyverse"

def asset_factor(target, crit):
    return 10 if (target == "inet" and crit in ("critical", "high")) else (7 if target == "inet" else 5)

def composite(cvss, epss, kev, af):
    return round(0.4*cvss + 0.3*(epss*10) + 0.2*(10 if kev else 0) + 0.1*af, 2)

def main():
    slug = detect_slug()
    engine = create_engine(TMPL.format(slug=slug))
    with engine.begin() as c:
        tid = c.execute(text("SELECT id FROM grc_tenants LIMIT 1")).scalar()
        inet = c.execute(text("""SELECT id,name,criticality FROM grc_it_assets WHERE internet_facing=true
                                 ORDER BY (name ~* '^(ubuntu|liztek)') DESC, length(name) ASC, id LIMIT 1""")).fetchone()
        if not inet:
            inet = c.execute(text("SELECT id,name,criticality FROM grc_it_assets ORDER BY id LIMIT 1")).fetchone()
        local = c.execute(text("SELECT id,name,criticality FROM grc_it_assets WHERE internet_facing=false OR internet_facing IS NULL ORDER BY id LIMIT 1")).fetchone()
        if not local:
            local = inet
        if not inet:
            print(f"tenant '{slug}' has no assets to link to — aborting."); return
        print(f"tenant={slug} (id {tid})  inet_asset={inet[0]}:{inet[1]}  local_asset={local[0]}:{local[1]}")

        existing = {r[0] for r in c.execute(text("SELECT cve_id FROM grc_vulnerabilities WHERE cve_id IS NOT NULL"))}
        now = datetime.utcnow()
        added = 0
        for i, (cve, title, cwe, cvss, vec, sev, epss, kev, pub, edb, fam, target) in enumerate(CVES):
            if cve in existing:
                print(f"  skip (exists): {cve}"); continue
            asset = inet if target == "inet" else local
            af = asset_factor(target, inet[2] if target == "inet" else "medium")
            cp = composite(cvss, epss, kev, af)
            first = now - timedelta(days=(3 + i))
            vid = c.execute(text("""
                INSERT INTO grc_vulnerabilities
                  (tenant_id, vuln_id, title, description, severity, cvss_score, cvss_vector, cvss_version,
                   cve_id, cwe_id, cwe_ids, plugin_family, status, source,
                   epss_score, epss_percentile, kev_flag, kev_date_added, composite_priority,
                   public_exploit_count, exploitdb_count, remediation_guidance,
                   first_detected, last_seen, discovered_at, created_at, updated_at)
                VALUES
                  (:tid, :vid, :title, :descr, :sev, :cvss, :vec, '3.1',
                   :cve, :cwe, CAST(:cwes AS json), :fam, 'open', 'manual',
                   :epss, :epssp, :kev, :kevd, :cp,
                   :pub, :edb, :rem, :first, :last, :disc, :disc, :now)
                RETURNING id
            """), dict(
                tid=tid, vid=cve, title=title,
                descr=f"{title}. Publicly documented vulnerability ({cve}); mapped to {cwe}.",
                sev=sev, cvss=cvss, vec=vec, cve=cve, cwe=cwe, cwes=json.dumps([cwe]), fam=fam,
                epss=epss, epssp=min(0.99, epss), kev=kev, kevd=(now - timedelta(days=30)) if kev else None,
                cp=cp, pub=pub, edb=edb,
                rem=f"Apply the vendor patch for {cve}. Until patched, restrict exposure with a compensating control.",
                first=first, last=now, disc=first, now=now,
            )).scalar()
            # created_at/updated_at are ORM-side defaults that do NOT fire on a raw INSERT;
            # set them explicitly above, else VulnerabilityResponse (created_at: datetime,
            # non-optional) fails to serialise and getById + the list endpoint 500.
            c.execute(text("""
                INSERT INTO grc_vulnerability_asset_links (vulnerability_id, asset_id, link_source, auto_linked, created_at)
                VALUES (:v, :a, 'manual', false, :now) ON CONFLICT (vulnerability_id, asset_id) DO NOTHING
            """), dict(v=vid, a=asset[0], now=now))
            added += 1
            print(f"  + {cve:18} {cwe:9} {sev:8} AV={vec.split('AV:')[1][0]} -> asset {asset[0]}")

        # Self-heal: any row (from an earlier run of this script) left with a NULL
        # created_at breaks getById + the list endpoint (VulnerabilityResponse needs a
        # datetime). Backfill it so re-running this script repairs prod in place.
        healed = c.execute(text(
            "UPDATE grc_vulnerabilities SET created_at = COALESCE(created_at, discovered_at, first_detected, now()) "
            "WHERE created_at IS NULL")).rowcount
        c.execute(text("UPDATE grc_vulnerabilities SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL"))
        if healed:
            print(f"  healed {healed} row(s) that had a NULL created_at")

        total = c.execute(text("SELECT count(*) FROM grc_vulnerabilities")).scalar()
        withcve = c.execute(text("SELECT count(*) FROM grc_vulnerabilities WHERE cve_id IS NOT NULL AND cve_id<>''")).scalar()
        withcwe = c.execute(text("SELECT count(*) FROM grc_vulnerabilities WHERE cwe_id IS NOT NULL AND cwe_id<>''")).scalar()
        print(f"\nAdded {added} findings to '{slug}'. Now {total} vulns, {withcve} with CVE, {withcwe} with CWE.")

if __name__ == "__main__":
    main()
