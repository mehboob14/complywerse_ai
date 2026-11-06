#!/usr/bin/env python3
"""The AI inventory at a glance, and what each use case did in the tenants' usage ledgers.

    cd backend
    ./venv/Scripts/python.exe grc/tools/ai_inventory_report.py [--days 30] [--tenants complyverse,1link] [--markdown out.md]

Prints (1) the registry by module, trigger and protection profile, (2) the use cases that are reached by a GET request
or that fire on their own, and (3) for every tenant database: calls, tokens and failures per use case over the last
N days, matched through each event's call site. Calls that no registry entry claims and calls that were booked to a
shared helper (several use cases) are listed separately: those need an explicit ``usage_scope`` at their entry point.

Read-only. Opening a tenant engine runs the normal schema self-heal, exactly as that tenant's first request would.
"""
from __future__ import annotations

import argparse
import ast
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from grc.services.ai_gateway import callsites, registry  # noqa: E402


def _routes(path: str, qualname: str) -> list:
    """HTTP methods of the route decorators on a function (empty when it is not an endpoint)."""
    tree = callsites._parse(callsites.GRC / path)
    if tree is None:
        return []
    want = qualname.split(".")
    nodes, found = [tree], None
    for part in want:
        found = None
        for node in nodes:
            for child in ast.iter_child_nodes(node):
                if getattr(child, "name", None) == part:
                    found = child
        if found is None:
            return []
        nodes = [found]
    methods = []
    for d in getattr(found, "decorator_list", []):
        if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr in ("get", "post", "put", "patch", "delete"):
            methods.append(d.func.attr.upper())
    return methods


match_event = registry.match_event


def registry_summary() -> list:
    uc = registry.USE_CASES
    out = [f"Registry: {len(uc)} use cases in {len({u.module for u in uc})} modules; "
           f"{sum(u.ambient for u in uc)} fire on their own (view or auto), {sum(u.outside_shim for u in uc)} outside the shim, "
           f"{len({cs for u in uc for cs in u.callsites})} provider-call functions"]
    for title, key in (("trigger", lambda u: u.trigger), ("profile", lambda u: u.profile), ("level", lambda u: u.level)):
        out.append(f"  by {title}: " + ", ".join(f"{k} {n}" for k, n in sorted(Counter(key(u) for u in uc).items())))
    out.append("")
    for module, label in registry.MODULES.items():
        mine = [u for u in uc if u.module == module]
        if mine:
            out.append(f"  {label:<26} {len(mine):>3}  (click {sum(u.trigger == 'click' for u in mine)}, "
                       f"view {sum(u.trigger == 'view' for u in mine)}, auto {sum(u.trigger == 'auto' for u in mine)}, "
                       f"background {sum(u.trigger == 'background' for u in mine)}, offline {sum(u.trigger == 'offline' for u in mine)})")
    return out


def ambient_and_get() -> list:
    out = ["Use cases that fire without a click, or sit behind a GET (a GET must never write; confirm per page whether it fires on open):"]
    for u in registry.USE_CASES:
        gets = sorted({"GET" for cs in (u.entry or u.callsites) if not cs.startswith("ava-pentest-engine/")
                       for m in _routes(*cs.split(":", 1)) if m == "GET"})
        if u.ambient or gets:
            out.append(f"  {u.id:<44} trigger={u.trigger:<10} {'GET route' if gets else '':<10} {u.label}")
    return out


def ledger(tenants, days: int) -> list:
    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env", override=True)
    from sqlalchemy import text
    from grc.db import get_master_db, get_tenant_engine

    since = datetime.utcnow() - timedelta(days=days)
    master = next(get_master_db())
    slugs = [r[0] for r in master.execute(text("select slug from grc_tenants order by id"))]
    out = []
    for slug in slugs:
        if tenants and slug not in tenants:
            continue
        try:
            with get_tenant_engine(slug).connect() as conn:
                rows = conn.execute(text(
                    "select module_key, feature_key, usage_metadata, status, total_tokens, estimated_cost "
                    "from ai_usage_events where occurred_at >= :since"), {"since": since}).all()
        except Exception as exc:  # noqa: BLE001
            out.append(f"{slug}: cannot read the ledger ({type(exc).__name__})")
            continue
        per, shared, unmapped, coarse = defaultdict(lambda: [0, 0, 0]), Counter(), Counter(), Counter()
        for module, feature, meta, status, tokens, _cost in rows:
            callsite = (meta or {}).get("callsite", "") if isinstance(meta, dict) else ""
            if module in ("services", "unclassified"):
                coarse[f"{module}/{feature}"] += 1
            hits = match_event(callsite, feature)
            if len(hits) == 1:
                row = per[hits[0].id]
                row[0] += 1
                row[1] += int(tokens or 0)
                row[2] += status != "success"
            elif hits:
                shared[f"{callsite.split(':')[0]} [{module}/{feature}]  ->  " + ", ".join(sorted(u.id for u in hits))] += 1
            else:
                unmapped[f"{callsite or '(no call site)'}  [{module}/{feature}]"] += 1
        out.append(f"{slug}: {len(rows)} events in the last {days} days; {sum(r[0] for r in per.values())} matched one use case, "
                   f"{sum(shared.values())} could be several (shared helper or file), {sum(unmapped.values())} unmatched")
        for uid, (calls, tokens, failed) in sorted(per.items(), key=lambda kv: -kv[1][0]):
            out.append(f"    {uid:<44} calls {calls:>5}  tokens {tokens:>9}  failed {failed}")
        for label, n in shared.most_common():
            out.append(f"    several possible {n:>4}  {label}")
        for label, n in unmapped.most_common():
            out.append(f"    unmatched       {n:>5}  {label}")
        if coarse:
            out.append("    coarse attribution (module 'services'/'unclassified'): " + ", ".join(f"{k} x{n}" for k, n in coarse.most_common()))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--tenants", default="", help="comma-separated tenant slugs (default: all)")
    ap.add_argument("--markdown", default="", help="also write the report to this file")
    ap.add_argument("--no-ledger", action="store_true", help="registry only, do not open any tenant database")
    args = ap.parse_args(argv)

    lines = registry_summary() + [""] + ambient_and_get()
    if not args.no_ledger:
        lines += ["", f"Usage ledgers, last {args.days} days:"] + ledger({t for t in args.tenants.split(",") if t}, args.days)
    text_out = "\n".join(lines)
    sys.stdout.reconfigure(encoding="utf-8")
    print(text_out)
    if args.markdown:
        Path(args.markdown).write_text("```\n" + text_out + "\n```\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
