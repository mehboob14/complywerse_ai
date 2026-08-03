"""Reversible demo seeder for the Token-usage dashboard.

Backfills realistic AI-usage history (and per-module budgets) so the dashboard
renders fully populated — like the design prototype — before real usage has had
time to accumulate. Every row it writes is tagged so it can be removed exactly:

  * AIUsageEvent rows -> attribution_source="demo"
  * AIModuleBudget rows -> updated_by="demo_seed" (only created if absent; real
    budgets are never overwritten)

Real captured usage is never touched, and demo events sit alongside live ones.

Usage (run from the backend dir, with the tenant's DB reachable):
  python -m grc.scripts.seed_demo_ai_usage --slug <tenant> [--days 90]
  python -m grc.scripts.seed_demo_ai_usage --slug <tenant> --wipe
"""

from __future__ import annotations

import argparse
import random
from datetime import datetime, timedelta

from ..db import open_tenant_session
from ..models import AIUsageEvent, AIModuleBudget
from ..services.ai_usage_report import get_or_create_config

DEMO_MARKER = "demo"          # AIUsageEvent.attribution_source
BUDGET_MARKER = "demo_seed"   # AIModuleBudget.updated_by

# (module_key, share of daily volume, monthly budget in M tokens, [feature keys])
MODULES = [
    ("risks", 0.30, 16, ["ai_risk_scoring", "assessment_summaries", "control_suggestions",
                          "auto_categorization", "duplicate_detection", "anomaly_narratives",
                          "threshold_alerts", "board_report_drafts"]),
    ("compliance", 0.24, 13, ["evidence_analysis", "test_narratives", "crosswalk_suggestions",
                              "gap_analysis", "document_extraction", "evidence_tagging",
                              "reg_change_summaries"]),
    ("audit", 0.16, 9, ["workpaper_review", "interview_summaries", "finding_drafts",
                        "remediation_plans", "scope_suggestions"]),
    ("vendor_risk", 0.14, 8, ["questionnaire_scoring", "soc2_analysis", "news_screening",
                              "alert_digests", "contract_review"]),
    ("governance", 0.08, 5, ["draft_generation", "clause_library", "comprehension_quizzes",
                             "reminder_copy"]),
    ("incident", 0.08, 5, ["timeline_reconstruction", "root_cause_drafts",
                           "triage_classification", "severity_suggestions"]),
]

# Demo consumers (names only — no rows added to the user table, so nothing to
# clean up there; department shows as "—" which is fine for a preview).
CONSUMERS = [
    "Priya Nair", "Marcus Bell", "Elena Rossi", "David Okafor",
    "Sara Lindqvist", "James Whitfield", "Aisha Rahman", "Tomás Silva",
]

# Business-hour weighting so intraday bars look natural.
HOUR_WEIGHTS = ([9, 10, 11, 13, 14, 15, 16] * 4) + [8, 12, 17, 18] * 2 + [7, 19, 20, 21]

DAILY_TOTAL = 1_330_000  # ≈ design's ~40M over 30 days
MODEL = "gpt-4o"


def _weekday_factor(d: datetime) -> float:
    return 0.35 if d.weekday() >= 5 else 1.0  # quieter weekends


def wipe(db) -> None:
    events = db.query(AIUsageEvent).filter(AIUsageEvent.attribution_source == DEMO_MARKER).delete()
    budgets = db.query(AIModuleBudget).filter(AIModuleBudget.updated_by == BUDGET_MARKER).delete()
    db.commit()
    print(f"Removed {events} demo usage events and {budgets} demo module budgets.")


def seed(db, days: int) -> None:
    rng = random.Random(42)  # deterministic
    now = datetime.utcnow()

    # budgets (only where none exists — never clobber real config)
    get_or_create_config(db)
    existing = {b.module_key for b in db.query(AIModuleBudget).all()}
    added_budgets = 0
    for key, _share, budget_m, _feats in MODULES:
        if key not in existing:
            db.add(AIModuleBudget(module_key=key, monthly_budget=budget_m * 1_000_000, updated_by=BUDGET_MARKER))
            added_budgets += 1

    events = 0
    total_tokens = 0
    for d in range(days):
        day = now - timedelta(days=d)
        day_factor = _weekday_factor(day) * (0.75 + rng.random() * 0.6)  # ±noise
        daily_total = DAILY_TOTAL * day_factor
        for key, share, _budget, feats in MODULES:
            module_total = daily_total * share
            n_events = rng.randint(3, 7)
            for _ in range(n_events):
                # today: keep hours ≤ current hour so the 24h view is realistic
                hour = rng.choice([h for h in HOUR_WEIGHTS if not (d == 0 and h > now.hour)] or [now.hour])
                ts = day.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59), microsecond=0)
                if ts > now:
                    ts = now - timedelta(minutes=rng.randint(1, 30))
                tokens = max(500, int(module_total / n_events * (0.6 + rng.random() * 0.8)))
                prompt = int(tokens * (0.65 + rng.random() * 0.2))
                completion = max(0, tokens - prompt)
                user = rng.choice(CONSUMERS)
                db.add(AIUsageEvent(
                    occurred_at=ts,
                    request_id=f"demo-{d}-{events}",
                    operation_id=f"demo-{d}-{events}",
                    actor_user_id=None,
                    actor_username=user,
                    actor_type="user",
                    module_key=key,
                    feature_key=rng.choice(feats),
                    attribution_source=DEMO_MARKER,
                    provider="openai",
                    api_family="chat_completions",
                    requested_model=MODEL,
                    response_model=MODEL,
                    prompt_tokens=prompt,
                    completion_tokens=completion,
                    total_tokens=tokens,
                    status="success" if rng.random() > 0.02 else "failed",
                    duration_ms=rng.randint(400, 4000),
                    usage_metadata={"seed": "demo_ai_usage"},
                ))
                events += 1
                total_tokens += tokens
        if d % 15 == 0:
            db.commit()  # periodic flush
    db.commit()
    print(f"Seeded {events} demo events (~{total_tokens/1_000_000:.1f}M tokens) over {days} days, "
          f"{added_budgets} module budgets set.")
    print("Wipe anytime with:  python -m grc.scripts.seed_demo_ai_usage --slug <tenant> --wipe")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed/wipe demo AI usage for the Token-usage dashboard.")
    parser.add_argument("--slug", required=True, help="Tenant slug (its DB will be seeded).")
    parser.add_argument("--days", type=int, default=90, help="How many days of history to backfill.")
    parser.add_argument("--wipe", action="store_true", help="Remove all demo rows instead of seeding.")
    args = parser.parse_args()

    db = open_tenant_session(args.slug)
    try:
        if args.wipe:
            wipe(db)
        else:
            seed(db, max(args.days, 1))
    finally:
        db.close()


if __name__ == "__main__":
    main()
