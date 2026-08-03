"""List the rules still flagged as placeholder after the first resynth pass.

Print rule_id, title, what the synthesizer produced (command + expect), and
the first 600 chars of audit text so we can see exactly what's missing.
"""
from __future__ import annotations
import json, os
from collections import defaultdict
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])


def looks_concrete(cd) -> bool:
    if not isinstance(cd, dict):
        return False
    cmd = cd.get("command")
    if not (isinstance(cmd, str) and cmd.strip()):
        return False
    if "REPLACE-ME" in cmd:
        return False
    expect = cd.get("expect") or {}
    if not isinstance(expect, dict):
        return False
    if expect.get("kind") in ("exit_zero", "any", None):
        return False
    for v in expect.values():
        if isinstance(v, str) and v.startswith("TODO"):
            return False
    return True


with eng.connect() as conn:
    rows = conn.execute(text(
        """SELECT id, benchmark, rule_id, title, audit_steps_text, check_definition
           FROM grc_compliance_plugins
           WHERE tenant_id IS NULL
           ORDER BY benchmark, rule_id"""
    )).mappings().all()

remaining = []
for r in rows:
    cd = r["check_definition"]
    if isinstance(cd, str):
        try:
            cd = json.loads(cd)
        except Exception:
            cd = {}
    if not looks_concrete(cd):
        remaining.append({"row": r, "cd": cd})

print(f"Total remaining: {len(remaining)}\n")

# Group by section
by_section = defaultdict(list)
for item in remaining:
    rid = item["row"]["rule_id"]
    parts = rid.split(".")
    section = ".".join(parts[:2]) if len(parts) >= 2 else parts[0]
    by_section[section].append(item)

print("=== Distribution ===")
for sec, items in sorted(by_section.items(), key=lambda kv: -len(kv[1])):
    print(f"  Section {sec}: {len(items)} rules")
print()

print("=== All remaining rules ===")
for sec, items in sorted(by_section.items(), key=lambda kv: -len(kv[1])):
    print(f"\n--- Section {sec} ({len(items)}) ---")
    for item in items:
        r = item["row"]
        cd = item["cd"]
        cmd = (cd.get("command") or "")[:120]
        expect = cd.get("expect", {})
        audit = (r["audit_steps_text"] or "")[:300].replace("\n", " | ")
        print(f"  {r['rule_id']:<14} {(r['title'] or '')[:75]}")
        print(f"    cmd:    {cmd}")
        print(f"    expect: {expect}")
        print(f"    audit:  {audit}")
