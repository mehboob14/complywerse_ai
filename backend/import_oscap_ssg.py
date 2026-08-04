"""Import SCAP Security Guide (SSG) rules as real oscap-backed CompliancePlugins.

Replaces the broken PDF-auto-generated Linux CIS plugins with genuine OpenSCAP
rules for a chosen profile, and repoints the OS→benchmark mapping so the asset
scans the real content.

What it does (idempotent):
  1. Parses the SSG datastream, extracting the rules SELECTED by --profile
     (id, title, severity, description, rationale, remediation).
  2. Upserts one CompliancePlugin per rule (tenant_id=NULL, is_builtin=True,
     runner_type="oscap", enabled=True, review_status="approved") under
     --benchmark, with check_definition carrying the oscap spec the runner needs.
  3. Upserts a global BenchmarkOsMapping (--os-pattern → --benchmark, priority 1)
     and DEACTIVATES any mapping that pointed the same OS at --replace-benchmark
     (the broken auto-generated benchmark), so only the real rules get scanned.

Runs against ONE tenant DB at a time (global rows live per-database here).

Usage (from backend/):
  python import_oscap_ssg.py --tenant 1link \
     --datastream /opt/ssg/ssg-ubuntu2404-ds.xml \
     --profile   xccdf_org.ssgproject.content_profile_cis_level1_server \
     --benchmark CIS_Ubuntu_24.04_L1_Server_OpenSCAP \
     --os-pattern ubuntu-24.04 \
     --replace-benchmark CIS_Ubuntu_Linux_24.04_LTS_Benchmark_v1.0.0
"""
import argparse
import sys
import xml.etree.ElementTree as ET
from datetime import datetime

from grc.models import CompliancePlugin, BenchmarkOsMapping
from grc.models._38_database_initialization_functions import open_tenant_session

_SEV_MAP = {"high": "high", "medium": "medium", "low": "low",
            "info": "low", "unknown": "medium"}


def _strip(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _text(el) -> str:
    return " ".join("".join(el.itertext()).split())


def parse_datastream(path: str, profile_id: str):
    """Return list of {rule_id,title,severity,description,rationale,remediation}
    for the rules selected by profile_id."""
    tree = ET.parse(path)
    root = tree.getroot()
    rules: dict[str, dict] = {}
    profiles: dict[str, set] = {}
    for el in root.iter():
        tag = _strip(el.tag)
        if tag == "Rule":
            rid = el.get("id")
            if not rid:
                continue
            entry = {"rule_id": rid,
                     "severity": _SEV_MAP.get((el.get("severity") or "unknown").lower(), "medium"),
                     "title": "", "description": "", "rationale": "", "remediation": ""}
            for ch in el:
                ct = _strip(ch.tag)
                if ct == "title":
                    entry["title"] = _text(ch)[:500]
                elif ct == "description":
                    entry["description"] = _text(ch)[:4000]
                elif ct == "rationale":
                    entry["rationale"] = _text(ch)[:4000]
                elif ct in ("fixtext", "fix"):
                    if not entry["remediation"]:
                        entry["remediation"] = _text(ch)[:4000]
            rules[rid] = entry
        elif tag == "Profile":
            pid = el.get("id")
            sel = set()
            for ch in el:
                if _strip(ch.tag) == "select" and (ch.get("selected") or "").lower() in ("true", "1"):
                    sel.add(ch.get("idref"))
            profiles[pid] = sel

    if profile_id not in profiles:
        sys.exit(f"Profile not found: {profile_id}\nAvailable: {sorted(profiles)}")
    selected = profiles[profile_id]
    out = [rules[r] for r in selected if r in rules]
    if not out:
        sys.exit("Profile selected 0 known rules — datastream/profile mismatch?")
    return out


def import_plugins(db, rows, *, benchmark, datastream, profile):
    ins = upd = 0
    for r in rows:
        short = r["rule_id"].split("content_rule_", 1)[-1]
        check_def = {"oscap": {"rule_id": r["rule_id"], "datastream": datastream,
                               "profile": profile}, "_engine": "openscap"}
        existing = (db.query(CompliancePlugin)
                    .filter(CompliancePlugin.tenant_id.is_(None),
                            CompliancePlugin.plugin_key == r["rule_id"]).first())
        fields = dict(
            benchmark=benchmark, rule_id=short, title=r["title"] or short,
            description=r["description"], rationale=r["rationale"],
            remediation=r["remediation"], severity=r["severity"],
            runner_type="oscap", check_definition=check_def,
            source_url="https://www.cisecurity.org/benchmark/ubuntu_linux",
            is_builtin=True, enabled=True, review_status="approved",
        )
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
            db.add(existing)
            upd += 1
        else:
            db.add(CompliancePlugin(tenant_id=None, plugin_key=r["rule_id"], **fields))
            ins += 1
    return ins, upd


def fix_mapping(db, *, os_pattern, benchmark, replace_benchmark):
    deactivated = 0
    if replace_benchmark:
        for m in (db.query(BenchmarkOsMapping)
                  .filter(BenchmarkOsMapping.benchmark_name == replace_benchmark).all()):
            if (m.os_pattern or "").lower().strip() == os_pattern.lower().strip() and m.is_active:
                m.is_active = False
                db.add(m)
                deactivated += 1
    existing = (db.query(BenchmarkOsMapping)
                .filter(BenchmarkOsMapping.tenant_id.is_(None),
                        BenchmarkOsMapping.os_pattern == os_pattern,
                        BenchmarkOsMapping.benchmark_name == benchmark).first())
    if existing:
        existing.is_active = True
        existing.priority = 1
        db.add(existing)
    else:
        db.add(BenchmarkOsMapping(tenant_id=None, os_pattern=os_pattern,
                                  benchmark_name=benchmark, is_active=True, priority=1,
                                  notes="OpenSCAP SSG import"))
    return deactivated


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", required=True)
    ap.add_argument("--datastream", required=True)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--benchmark", required=True)
    ap.add_argument("--os-pattern", default="ubuntu-24.04")
    ap.add_argument("--replace-benchmark", default="")
    args = ap.parse_args()

    rows = parse_datastream(args.datastream, args.profile)
    print(f"Parsed {len(rows)} rules from profile.")
    db = open_tenant_session(args.tenant)
    try:
        ins, upd = import_plugins(db, rows, benchmark=args.benchmark,
                                  datastream=args.datastream, profile=args.profile)
        deact = fix_mapping(db, os_pattern=args.os_pattern, benchmark=args.benchmark,
                            replace_benchmark=args.replace_benchmark)
        db.commit()
        print(f"Plugins: inserted {ins}, updated {upd} under '{args.benchmark}'.")
        print(f"Mapping: {args.os_pattern} → {args.benchmark} (deactivated {deact} broken mapping(s)).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
