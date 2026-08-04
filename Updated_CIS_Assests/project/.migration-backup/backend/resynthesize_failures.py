"""Re-run the updated gen_check synthesizer on every plugin whose stored
check_definition is the "REPLACE-ME" placeholder, then persist the result.

Iterates ALL builtin plugins (tenant_id IS NULL), re-synthesises a check
from the rule's audit_steps_text + title, and if the new check is concrete
(non-placeholder, with a meaningful expect), writes it back to the DB.

Prints a before/after report.
"""
from __future__ import annotations
import json, os, copy
from collections import Counter

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=eng)


from grc.modules.compliance_plugins.pdf_ingest.gen_check import synthesise


PLACEHOLDER_NOTES = (
    "parser could not synthesise",
    "could not synthesise an executable",
)


def is_placeholder(cd) -> bool:
    if not isinstance(cd, dict):
        return True
    note = (cd.get("_note") or "").lower() if isinstance(cd.get("_note"), str) else ""
    if any(p in note for p in PLACEHOLDER_NOTES):
        return True
    cmd = cd.get("command") or ""
    if isinstance(cmd, str) and "REPLACE-ME" in cmd:
        return True
    return False


def is_concrete(cd) -> bool:
    if not isinstance(cd, dict):
        return False
    if is_placeholder(cd):
        return False
    cmd = cd.get("command")
    if not (isinstance(cmd, str) and cmd.strip()):
        return False
    expect = cd.get("expect") or {}
    if not isinstance(expect, dict):
        return False
    kind = expect.get("kind")
    if kind in ("exit_zero", "any", None):
        return False
    # Reject TODO sentinels
    for v in expect.values():
        if isinstance(v, str) and v.startswith("TODO"):
            return False
    return True


def main():
    with eng.connect() as conn:
        rows = conn.execute(text(
            """SELECT id, benchmark, rule_id, title, audit_steps_text, runner_type, check_definition
               FROM grc_compliance_plugins
               WHERE tenant_id IS NULL
               ORDER BY benchmark, rule_id"""
        )).mappings().all()

    total = len(rows)
    before_concrete = 0
    fixed = 0
    still_placeholder = 0
    examples_fixed: list[dict] = []
    examples_still: list[dict] = []
    new_kinds = Counter()

    sess = Session()
    try:
        from grc.models import CompliancePlugin
        for r in rows:
            cd = r["check_definition"]
            if isinstance(cd, str):
                try:
                    cd = json.loads(cd)
                except Exception:
                    cd = {}
            was_concrete = is_concrete(cd)
            if was_concrete:
                before_concrete += 1
                continue  # only touch rules that needed help
            # Re-synthesize
            new_cd, _auto = synthesise(
                r["audit_steps_text"] or "",
                r["runner_type"],
                rule_id=r["rule_id"],
                title=r["title"],
            )
            if is_concrete(new_cd):
                # Persist
                p = sess.get(CompliancePlugin, r["id"])
                if p is not None:
                    p.check_definition = copy.deepcopy(new_cd)
                    flag_modified(p, "check_definition")
                    fixed += 1
                    expect = new_cd.get("expect") or {}
                    new_kinds[expect.get("kind", "?")] += 1
                    if len(examples_fixed) < 8:
                        examples_fixed.append({
                            "rule_id": r["rule_id"],
                            "kind": expect.get("kind"),
                            "title": (r["title"] or "")[:90],
                            "command": (new_cd.get("command") or "")[:120],
                            "expect": {k: (str(v)[:80] if not isinstance(v, list) else v[:4]) for k, v in expect.items() if k != "value" or len(str(v)) < 80},
                        })
            else:
                still_placeholder += 1
                if len(examples_still) < 8:
                    examples_still.append({
                        "rule_id": r["rule_id"],
                        "title": (r["title"] or "")[:90],
                        "note": (new_cd.get("_note") or "")[:90],
                    })
        sess.commit()
    except Exception:
        sess.rollback()
        raise
    finally:
        sess.close()

    print(f"Total builtin plugins: {total}")
    print(f"Already concrete before: {before_concrete}")
    print(f"Fixed by re-synthesis:   {fixed}")
    print(f"Still placeholder:       {still_placeholder}")
    new_concrete = before_concrete + fixed
    print(f"NEW COVERAGE: {new_concrete}/{total} = {new_concrete/total*100:.2f}%")
    print()
    print("Distribution of new expect.kind values:")
    for k, v in new_kinds.most_common():
        print(f"  {v:>4}  {k}")
    print()
    print("=== Sample fixes ===")
    for e in examples_fixed:
        print(f"  {e['rule_id']:<12} [{e['kind']}]  {e['title']}")
        print(f"    cmd:    {e['command']}")
        print(f"    expect: {e['expect']}")
    if examples_still:
        print()
        print("=== Still-placeholder samples ===")
        for e in examples_still:
            print(f"  {e['rule_id']:<12} {e['title']}")
            print(f"    note: {e['note']}")


if __name__ == "__main__":
    main()
