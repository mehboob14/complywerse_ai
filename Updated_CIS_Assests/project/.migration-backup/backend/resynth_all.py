"""Re-synthesize ALL builtin plugins so cleaner pass/fail messages
land in the DB. Unlike resynthesize_failures.py which only fixed
placeholders, this updates every plugin's message templates from the
new title-based generator."""
from __future__ import annotations
import os, copy, json
from collections import Counter

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=eng)

from grc.modules.compliance_plugins.pdf_ingest.gen_check import synthesise
from grc.models import CompliancePlugin

sess = Session()
try:
    plugins = sess.query(CompliancePlugin).all()
    print(f"Re-synthesizing {len(plugins)} builtin plugins ...")
    changed = 0
    msg_kinds = Counter()
    for p in plugins:
        new_cd, _ = synthesise(
            p.audit_steps_text or "",
            p.runner_type,
            rule_id=p.rule_id,
            title=p.title,
        )
        if not isinstance(new_cd, dict):
            continue
        old_cd = p.check_definition or {}
        if isinstance(old_cd, str):
            try:
                old_cd = json.loads(old_cd)
            except Exception:
                old_cd = {}
        old_pass = (old_cd or {}).get("pass_message")
        new_pass = new_cd.get("pass_message")
        old_fail = (old_cd or {}).get("fail_message")
        new_fail = new_cd.get("fail_message")
        if old_pass != new_pass or old_fail != new_fail:
            p.check_definition = copy.deepcopy(new_cd)
            flag_modified(p, "check_definition")
            changed += 1
            cat = (new_cd.get("_extracted") or {}).get("category", "?")
            msg_kinds[cat] += 1
    sess.commit()
    print(f"Updated {changed} plugin message templates.")
    for k, v in msg_kinds.most_common():
        print(f"  {v:>4}  {k}")
finally:
    sess.close()
