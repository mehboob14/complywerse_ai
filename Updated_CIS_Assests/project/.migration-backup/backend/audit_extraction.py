"""Audit rule extraction quality — based on the *actual* stored schema.

Each plugin's check_definition is shaped like:
    { shell, command, expect, pass_message, fail_message,
      _auto_generated, _extracted, _audit_excerpt, _note }

A check is "concrete" when it has a real command + a non-trivial expect regex
that was synthesized from the rule's audit text. A "placeholder" check is one
the synthesizer admitted defeat on (no recognizable category, generic echo
command, or expect = `^.*$`).
"""
from __future__ import annotations

import json
import os
import re
from collections import Counter, defaultdict

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

REG_HINTS = ["reg query", "Get-ItemProperty", "HKLM:\\", "HKCU:\\"]
SECEDIT_HINTS = ["secedit /export", "secedit.exe /export", "MinimumPasswordLength", "PasswordHistorySize"]
AUDITPOL_HINTS = ["auditpol /get", "auditpol.exe /get"]
SERVICE_HINTS = ["Get-Service", "sc query", "Get-WmiObject Win32_Service"]
DEFAULT_EXPECTS = {"^.*$", ".*", ""}


def classify(cd: dict) -> tuple[str, bool, str]:
    """Return (category, is_concrete, reason)."""
    if not isinstance(cd, dict):
        return ("unknown", False, "non-dict check_definition")
    cmd_raw = cd.get("command") or ""
    cmd = cmd_raw.strip() if isinstance(cmd_raw, str) else str(cmd_raw)
    exp_raw = cd.get("expect")
    if isinstance(exp_raw, str):
        expect = exp_raw.strip()
    elif isinstance(exp_raw, dict):
        # compound matcher e.g. {"stdout_regex": "...", "stdout_equals": "..."}
        expect = next(
            (v.strip() if isinstance(v, str) else str(v) for v in exp_raw.values() if v),
            "",
        )
    else:
        expect = "" if exp_raw is None else str(exp_raw)
    note = (cd.get("_note") or "").lower() if isinstance(cd.get("_note"), str) else ""

    # Category by command shape
    if any(h.lower() in cmd.lower() for h in REG_HINTS):
        cat = "registry"
    elif any(h.lower() in cmd.lower() for h in SECEDIT_HINTS):
        cat = "secedit"
    elif any(h.lower() in cmd.lower() for h in AUDITPOL_HINTS):
        cat = "auditpol"
    elif any(h.lower() in cmd.lower() for h in SERVICE_HINTS):
        cat = "service"
    elif cmd:
        cat = "other_cmd"
    else:
        cat = "missing"

    # Concrete-ness
    if not cmd:
        return (cat, False, "no command")
    if expect in DEFAULT_EXPECTS:
        return (cat, False, "expect is wildcard")
    if "manual" in note or "gui" in note or "placeholder" in note:
        return (cat, False, f"note: {note[:60]}")
    if "review the audit" in cmd.lower() or "echo" in cmd.lower()[:8]:
        return (cat, False, "echo / manual command")
    # Looks real
    return (cat, True, "ok")


def main() -> None:
    with eng.connect() as conn:
        rows = (
            conn.execute(
                text(
                    """SELECT id, benchmark, rule_id, title, runner_type, check_definition, section_path, level
                       FROM grc_compliance_plugins
                       WHERE tenant_id IS NULL
                       ORDER BY benchmark, rule_id"""
                )
            )
            .mappings()
            .all()
        )

    print(f"Total builtin plugins: {len(rows)}\n")
    per_bench = defaultdict(list)
    for r in rows:
        per_bench[r["benchmark"]].append(dict(r))

    grand_concrete = 0
    grand_total = 0
    failures: list[dict] = []

    for bench, plugins in per_bench.items():
        cat_counter = Counter()
        concrete_per_cat = Counter()
        for p in plugins:
            cd = p["check_definition"]
            if isinstance(cd, str):
                try:
                    cd = json.loads(cd)
                except Exception:
                    cd = None
            cat, concrete, reason = classify(cd or {})
            cat_counter[cat] += 1
            if concrete:
                concrete_per_cat[cat] += 1
            else:
                failures.append(
                    {
                        "benchmark": bench,
                        "rule_id": p["rule_id"],
                        "title": (p["title"] or "")[:80],
                        "category": cat,
                        "reason": reason,
                        "level": p["level"],
                        "cmd": str((cd or {}).get("command", ""))[:140],
                        "expect": str((cd or {}).get("expect", ""))[:60],
                    }
                )

        total = len(plugins)
        concrete = sum(concrete_per_cat.values())
        grand_concrete += concrete
        grand_total += total

        print(f"=== {bench} ===")
        print(f"  Total: {total}   Concrete: {concrete}   Coverage: {concrete/total*100:.1f}%")
        for cat, cnt in cat_counter.most_common():
            cc = concrete_per_cat.get(cat, 0)
            print(f"    {cat:<14} {cc:>4}/{cnt:<4}  ({cc/cnt*100:5.1f}%)")
        print()

    print(f"GRAND TOTAL: {grand_concrete}/{grand_total} concrete  ({grand_concrete/grand_total*100:.2f}%)")
    print(f"Gap: {grand_total - grand_concrete} rules still placeholder/non-concrete\n")

    # Top reasons
    print("=== Top failure reasons ===")
    reason_counter = Counter(f["reason"] for f in failures)
    for reason, cnt in reason_counter.most_common(15):
        print(f"  {cnt:>4}  {reason}")

    print("\n=== Sample failures (first 30) ===")
    for f in failures[:30]:
        print(f"  [{f['benchmark'][-12:]}] {f['rule_id']:<10} cat={f['category']:<8} {f['reason']:<22} | {f['title']}")

    # Save full failure list
    out = os.path.join(os.path.dirname(__file__), "extraction_failures.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(failures, fh, indent=2)
    print(f"\nFull failure list written to: {out}")


if __name__ == "__main__":
    main()
