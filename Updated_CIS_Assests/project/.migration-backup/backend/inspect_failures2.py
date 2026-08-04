"""Per-section breakdown of remaining failures + full title list for each."""
from __future__ import annotations
import json, os, re
from collections import defaultdict

with open(os.path.join(os.path.dirname(__file__), "extraction_failures.json"), encoding="utf-8") as fh:
    failures = json.load(fh)


def section(rid: str) -> str:
    parts = rid.split(".")
    if len(parts) >= 2:
        return ".".join(parts[:2])
    return parts[0]


by_section: dict[str, list] = defaultdict(list)
for f in failures:
    by_section[section(f["rule_id"])].append(f)

print(f"Total failures: {len(failures)}\n")
for sec, items in sorted(by_section.items(), key=lambda kv: -len(kv[1])):
    print(f"Section {sec}: {len(items)} rules")
    for f in items[:5]:
        print(f"  {f['rule_id']:<12} {f['title'][:90]}")
    if len(items) > 5:
        print(f"  ... and {len(items)-5} more")
    print()
