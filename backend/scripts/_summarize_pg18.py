import json
from pathlib import Path

data = json.loads(Path("scripts/_out_cis_pg18_inventory.json").read_text(encoding="utf-8"))
print("total", data["total"], "counts", data["counts"])
print()
print("=== AUTHORED ===")
for r in data["rules"]:
    if r["classification"] == "authored_sql":
        title = (r["title"] or "")[:70]
        print(f"{r['rule_id']:8} {r['runner_type']:14} {r['expect_kind']:20} {title}")
print()
print("=== NEED AUTHORING ===")
for r in data["rules"]:
    if r["classification"] != "authored_sql":
        en = "Y" if r["enabled"] else "n"
        title = (r["title"] or "")[:75]
        print(f"{r['rule_id']:8} en={en} runner={r['runner_type']:14} {title}")
