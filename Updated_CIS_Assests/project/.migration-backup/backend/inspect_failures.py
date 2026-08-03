"""Drill into the 130 failing rules — what does the audit text actually say?

Group failures by category and print one sample audit_steps_text per group so
we can see which patterns the synthesizer needs to learn.
"""
from __future__ import annotations
import json, os, re
from collections import defaultdict
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

with open(os.path.join(os.path.dirname(__file__), "extraction_failures.json"), encoding="utf-8") as fh:
    failures = json.load(fh)


def group_for(rid: str, title: str) -> str:
    if rid.startswith("2.2."):
        return "user_rights_assignment"
    if rid.startswith("19."):
        return "hkcu_user_policy"
    if rid.startswith("17."):
        return "audit_policy"
    if rid.startswith("18."):
        return "hklm_machine_policy"
    if rid.startswith("9."):
        return "firewall"
    if rid.startswith("5."):
        return "service_or_other"
    if rid.startswith("1."):
        return "password_account_policy"
    return "other"


grouped: dict[str, list] = defaultdict(list)
for f in failures:
    grouped[group_for(f["rule_id"], f["title"])].append(f)

print("=== Failure distribution by section ===")
for g, items in sorted(grouped.items(), key=lambda kv: -len(kv[1])):
    print(f"  {g:<26} {len(items)}")
print()

# Fetch audit_steps_text + description for one sample from each group
ids = []
samples_per_group = {}
for g, items in grouped.items():
    sample = items[0]
    samples_per_group[g] = sample
    ids.append((sample["benchmark"], sample["rule_id"]))

with eng.connect() as conn:
    for g, sample in samples_per_group.items():
        row = conn.execute(
            text(
                """SELECT rule_id, title, description, audit_steps_text, remediation
                   FROM grc_compliance_plugins
                   WHERE benchmark=:b AND rule_id=:r AND tenant_id IS NULL LIMIT 1"""
            ),
            {"b": sample["benchmark"], "r": sample["rule_id"]},
        ).mappings().first()
        print(f"========== Group: {g}  ({sample['rule_id']}) ==========")
        if not row:
            print("(not found)\n")
            continue
        print(f"TITLE: {row['title']}")
        audit = (row["audit_steps_text"] or "")[:1200]
        print("AUDIT TEXT (first 1200 chars):")
        print(audit)
        rem = (row["remediation"] or "")[:600]
        print("\nREMEDIATION (first 600 chars):")
        print(rem)
        print()
