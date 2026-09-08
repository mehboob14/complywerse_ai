"""Verify vulnerability attack chains: which findings have a real CWE (rich chain)
vs the generic CVSS backbone, and — per finding — whether the attacker can actually
reach each stage on its linked asset (the internet-facing gate).

    python3 scripts/verify_chains.py [tenant_slug]

Auto-detects the tenant if no slug is given. Read-only.
"""
import os, sys
_B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _B)
try:
    from dotenv import load_dotenv; load_dotenv(os.path.join(_B, ".env"))
except Exception:
    pass
from sqlalchemy import create_engine, text
from grc.db import open_tenant_session
from grc.models import Vulnerability, ITAsset
from grc.models._23_track_a_phase_7_cloud_connector_framework_foundation import VulnerabilityAssetLink
from grc.modules.vuln_management.attack.view import build_view

TMPL = os.environ["TENANT_DB_URL_TEMPLATE"]
MASTER = os.environ.get("MASTER_DATABASE_URL")

def detect_slug():
    if len(sys.argv) > 1:
        return sys.argv[1]
    eng = create_engine(MASTER or TMPL.format(slug="postgres"))
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
                if c.execute(text("SELECT count(*) FROM grc_it_assets WHERE name ILIKE '%liztek%' OR name ILIKE '%ubuntu%'")).scalar():
                    return slug
        except Exception:
            continue
    return "complyverse"

slug = detect_slug()
db = open_tenant_session(slug)
print(f"tenant: {slug}\n")

# 1) counts
tot = db.query(Vulnerability).count()
withcwe = db.query(Vulnerability).filter(Vulnerability.cwe_id.isnot(None), Vulnerability.cwe_id != "").count()
print(f"{tot} findings total · {withcwe} have a real CWE (rich chain) · {tot - withcwe} generic (no CWE)\n")

# 2) rich findings: asset exposure + reachability
print(f"{'CVE':16} {'CWE':9} {'SEV':8} {'ASSET':22} {'INET':5} {'VERDICT':9} REACHED/MAPPED")
print("-" * 92)
rich = (db.query(Vulnerability)
        .filter(Vulnerability.cwe_id.isnot(None), Vulnerability.cwe_id != "")
        .order_by(Vulnerability.severity.desc()).limit(30).all())
detail_targets = []
for v in rich:
    link = db.query(VulnerabilityAssetLink).filter(VulnerabilityAssetLink.vulnerability_id == v.id).first()
    a = db.query(ITAsset).filter(ITAsset.id == link.asset_id).first() if link else None
    if not a:
        print(f"{str(v.cve_id):16} {str(v.cwe_id):9} {str(v.severity):8} (no asset linked)")
        continue
    view = build_view(v, a)
    spine = view["tactic_spine"]
    mapped = [s for s in spine if (s.get("technique_ids") or [])]
    reached = [s for s in mapped if s["status"] == "reached"]
    print(f"{str(v.cve_id):16} {str(v.cwe_id):9} {str(v.severity):8} {str(a.name)[:22]:22} {str(a.internet_facing):5} {str(view['verdict'].get('verdict')):9} {len(reached)}/{len(mapped)}")
    detail_targets.append((v, a))

# 3) full gated chain for the first rich finding
if detail_targets:
    v, a = detail_targets[0]
    view = build_view(v, a)
    print(f"\n=== FULL CHAIN: {v.cve_id} on {a.name} (internet_facing={a.internet_facing}) ===")
    print(f"verdict={view['verdict'].get('verdict')}  entry_state={view['verdict'].get('entry_state')}")
    for s in view["tactic_spine"]:
        tids = s.get("technique_ids") or []
        mark = {"reached": "OK ", "unreachable": "XX ", "not_applicable": "-- "}.get(s["status"], "?  ")
        line = f"  {mark}{str(s['name'])[:22]:22} {str(s['status']):14} {tids}"
        if s["status"] == "unreachable" and s.get("reason"):
            line += f"\n        reason: {s['reason']}"
        print(line)
db.close()
