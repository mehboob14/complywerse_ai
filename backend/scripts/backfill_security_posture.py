"""Recompute ITAsset.security_posture with the deep scan's security read.

The posture used to come from the installed-software list only, so a
Defender-protected Windows host (Defender / the MDE sensor are OS components,
never "installed programs") read "Antivirus: None detected". This rewrites the
assets whose AV/EDR summary changes; computed_at is kept (it dates the
collection, not this backfill). Idempotent — a second run changes nothing.

Usage (from backend/):  python -m scripts.backfill_security_posture [--dry-run]
"""
import sys

from dotenv import load_dotenv
load_dotenv()

from grc.db import open_tenant_session
from grc.models import ITAsset, SessionLocal, Tenant
from grc.modules.compliance_plugins.services.security_classifier import summarize_posture

SUMMARY = ("has_antivirus", "antivirus_products", "has_edr", "edr_products",
           "edr_stopped", "endpoint_protected")
dry = "--dry-run" in sys.argv

master = SessionLocal()
try:
    slugs = [t.slug for t in master.query(Tenant).all() if getattr(t, "slug", None)]
finally:
    master.close()

for slug in slugs:
    db = open_tenant_session(slug)
    try:
        changed = 0
        for a in db.query(ITAsset).filter(ITAsset.security_posture.isnot(None)):
            old = a.security_posture if isinstance(a.security_posture, dict) else {}
            new = summarize_posture(a.detected_software_json, a.platform_properties)
            diff = [k for k in SUMMARY if old.get(k, []) != new[k]]
            if not diff:
                continue
            changed += 1
            new["computed_at"] = old.get("computed_at") or new["computed_at"]
            print(f"  {slug} #{a.id} {a.host_name or a.name}: "
                  + "; ".join(f"{k} {old.get(k)} -> {new[k]}" for k in diff))
            a.security_posture = new
        if not dry:
            db.commit()
        print(f"{slug}: {changed} asset(s) {'would change' if dry else 'updated'}")
    finally:
        db.close()
