"""Master Control List — Stage 1 test on the 15-framework set.
Harvest families -> build ONE canonical master list (AI sees all names at once)
-> PRINT it for review. (Mapping happens in Stage 2 after approval.)
"""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
base = os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0]
db = sessionmaker(bind=create_engine(base + "/grc_complyverse"))()
from grc.models import ParsedFrameworkControl, UploadedFramework
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model
client = get_openai_client()

FW = [11, 18, 3, 19, 27, 28, 8, 9, 4, 16, 6, 15, 7, 10, 29]   # 15 frameworks
fwn = {f.id: f.name for f in db.query(UploadedFramework).all()}
rows = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id.in_(FW)).all()
members = [{"ref":"parsed","ref_id":p.id,"framework":fwn.get(p.uploaded_framework_id,'?'),
            "code":p.original_reference or '',"name":(p.title or '')[:200],
            "text":(p.description or p.full_text or '')[:300]} for p in rows]
members = N._interleave_by_framework(members)
print(f"controls: {len(members)} across {len(FW)} frameworks", flush=True)

# STEP 1 — harvest a family label per control
print("STEP 1: harvesting families...", flush=True)
tags = N._ai_tag_controls(client, members)
fam_examples = {}
for m, t in zip(members, tags):
    if t:
        fam_examples.setdefault(t, [])
        if len(fam_examples[t]) < 3:
            fam_examples[t].append(m["name"][:40])
families = sorted(fam_examples.keys())
print(f"   harvested {len(families)} raw candidate families (with drift)", flush=True)

# cache harvest so Step 2 can be iterated without re-tagging
json.dump({"families": families, "fam_examples": fam_examples}, open("/tmp/harvest.json", "w"))
# STEP 2 — consolidate ALL family names at once into the canonical master list
print("STEP 2: building canonical master list (global view)...", flush=True)
SYS = ("You are a GRC taxonomist DE-DUPLICATING a harvested control-family list. The "
 "list contains DUPLICATES caused by labeling drift — the same control requirement "
 "got two different labels in different batches. Your job is to find and merge ONLY "
 "those drift-duplicates, while preserving every genuinely-distinct control.")
lines = [f"[{i}] {fam}  (examples: {', '.join(fam_examples[fam])})" for i, fam in enumerate(families)]
prompt = (
 "Merge the drift-duplicates in this harvested family list.\n\n"
 "TWO families are the SAME (merge) only if a control from one could equally sit in "
 "the other — SAME specific action on the SAME object (use the examples to judge). "
 "e.g. 'Audit Logging' = 'Logging & Monitoring'; 'Risk Assessment' = 'Risk Analysis'.\n\n"
 "KEEP SEPARATE (never merge):\n"
 "  • different LIFECYCLE stages — Incident Detection / Reporting / Response / "
 "Testing / Training are FIVE controls; access Grant / Review / Revoke / Terminate "
 "are separate; Plan / Test / Train are separate.\n"
 "  • POLICY vs OPERATION; and ADJACENT actions — Logging vs Log Retention; Backup "
 "vs Recovery vs Disposal; Vulnerability Scanning vs Patching.\n\n"
 "Most families are DISTINCT and map to themselves. Only genuine drift-duplicates "
 "merge — expect to merge perhaps 20-40% of them, not collapse into broad buckets. "
 "If a merged control would need 'and' to describe two actions, DON'T merge.\n\n"
 "For EACH master return: name, statement (one sentence), absorbs (input indices). "
 "A distinct family maps to itself (absorbs=[its index]).\n\n"
 "Families:\n" + "\n".join(lines) +
 '\n\nRespond ONLY JSON: {"masters":[{"name":"...","statement":"...","absorbs":[0]}]}')
resp = client.chat.completions.create(model=get_openai_model(),
    messages=[{"role":"system","content":SYS},{"role":"user","content":prompt}],
    response_format={"type":"json_object"}, temperature=0.0)
data = json.loads(resp.choices[0].message.content or "{}")
masters = data.get("masters", []) or []
# count controls per master via absorbed families
fam_count = {}
for m, t in zip(members, tags):
    if t: fam_count[t] = fam_count.get(t, 0) + 1
print(f"\n=== CANONICAL MASTER LIST: {len(masters)} controls (from {len(families)} raw families) ===\n", flush=True)
out = []
for mc in masters:
    absorbed = [families[i] for i in mc.get("absorbs", []) if 0 <= i < len(families)]
    nctrl = sum(fam_count.get(f, 0) for f in absorbed)
    out.append((nctrl, mc.get("name",""), absorbed))
for nctrl, name, absorbed in sorted(out, key=lambda x: -x[0]):
    merged = f"  ⟵ merges: {', '.join(absorbed)}" if len(absorbed) > 1 else ""
    print(f"  {name[:46]:46} ({nctrl} controls){merged}", flush=True)
# save master list for stage 2
json.dump({"masters":masters,"families":families}, open("/tmp/master_list.json","w"))
print(f"\nMASTERDONE: {len(masters)} master controls (saved)", flush=True)
db.close()
