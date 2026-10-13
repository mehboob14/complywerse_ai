#!/usr/bin/env python3
"""Where the AI tokens go, per tenant, read from the usage ledgers (the same figures as Administration -> AI Governance).

    cd backend
    ./venv/Scripts/python.exe grc/tools/ai_cost_report.py [--days 30] [--tenants complyverse,1link]

For every tenant database: calls, input vs output tokens, hidden reasoning, the provider's prompt cache, our result cache,
calls that repeated an earlier one exactly, retries, and the same per feature. Read-only. It is what to run on a VM before
deciding which cost lever to pull. Cost in USD appears once AI_USAGE_PRICE_CATALOG_JSON holds the model prices.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def pct(part: int, whole: int) -> str:
    return f"{round(100 * part / whole)}%" if whole else "-"


def report(slug: str, days: int) -> list:
    from grc.db import open_tenant_session
    from grc.modules.ai_governance import service

    db = open_tenant_session(slug)
    try:
        o = service.overview(db, days)
    finally:
        db.close()
    t = o["totals"]
    cost = f"${t['cost_usd']:.2f}" if t["cost_configured"] else "price not set"
    out = [f"{slug}: {t['calls']} calls, {t['tokens']:,} tokens, {cost} (last {days} days{', first 5,000 calls only' if o['truncated'] else ''})"]
    if not t["calls"]:
        return out
    out += [
        f"  input {pct(t['input_tokens'], t['tokens'])} / output {pct(t['output_tokens'], t['tokens'])}; hidden reasoning {pct(t['reasoning_tokens'], t['output_tokens'])} of output",
        f"  provider prompt cache {pct(t['cached_tokens'], t['input_tokens'])} of input; our result cache {t['cache_hits']} hits, {t['saved_tokens']:,} tokens saved",
        f"  repeated exactly and not cached: {t['repeat_calls']} calls, {t['repeat_tokens']:,} tokens (hash known for {t['with_hash']} of {t['calls']} calls); retries {t['retries']}; refused {t['blocked']}; failed {t['failed']}",
        f"  {'feature':<46}{'calls':>6}{'in/call':>9}{'out/call':>9}{'reason':>8}{'p.cache':>8}{'hits':>6}{'repeat':>7}",
    ]
    for u in o["use_cases"]:
        n = max(1, u["calls"])
        out.append(f"  {u['label'][:45]:<46}{u['calls']:>6}{u['input_tokens'] // n:>9}{u['output_tokens'] // n:>9}"
                   f"{pct(u['reasoning_tokens'], u['output_tokens']):>8}{pct(u['cached_tokens'], u['input_tokens']):>8}{u['cache_hits']:>6}{u['repeat_calls']:>7}")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--tenants", default="", help="comma-separated tenant slugs (default: all)")
    args = ap.parse_args(argv)

    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env", override=True)
    from sqlalchemy import text
    from grc.db import get_master_db

    wanted = {t for t in args.tenants.split(",") if t}
    slugs = [r[0] for r in next(get_master_db()).execute(text("select slug from grc_tenants order by id"))]
    sys.stdout.reconfigure(encoding="utf-8")
    for slug in slugs:
        if wanted and slug not in wanted:
            continue
        try:
            print("\n".join(report(slug, args.days)))
        except Exception as exc:  # noqa: BLE001
            print(f"{slug}: cannot read the ledger ({type(exc).__name__})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
