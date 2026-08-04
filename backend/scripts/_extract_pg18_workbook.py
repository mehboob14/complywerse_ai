"""Extract compact authoring workbook from PG18 inventory."""
import json
from pathlib import Path

data = json.loads(Path("scripts/_out_cis_pg18_inventory.json").read_text(encoding="utf-8"))
rows = []
for r in data["rules"]:
    if r["classification"] == "authored_sql":
        continue
    cd = r.get("check_definition") or {}
    rows.append(
        {
            "id": r["id"],
            "plugin_key": r["plugin_key"],
            "rule_id": r["rule_id"],
            "title": r["title"],
            "enabled": r["enabled"],
            "runner_type": r["runner_type"],
            "audit_steps_text": r.get("audit_steps_text") or "",
            "audit_excerpt": r.get("audit_excerpt") or "",
            "description_head": r.get("description_head") or "",
            "current_cd_keys": sorted(list(cd.keys())) if isinstance(cd, dict) else [],
        }
    )

Path("scripts/_out_cis_pg18_todo.json").write_text(
    json.dumps(rows, indent=2), encoding="utf-8"
)
# Also dump authored patterns for copy
authored = [r for r in data["rules"] if r["classification"] == "authored_sql"]
Path("scripts/_out_cis_pg18_authored_patterns.json").write_text(
    json.dumps(
        [
            {
                "rule_id": r["rule_id"],
                "title": r["title"],
                "check_definition": r["check_definition"],
            }
            for r in authored
        ],
        indent=2,
    ),
    encoding="utf-8",
)
print(f"todo={len(rows)} authored_patterns={len(authored)}")
