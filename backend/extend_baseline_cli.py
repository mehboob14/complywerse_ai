"""Extend the locked unified-library baseline with a NEW framework.

Run AFTER the framework's seed has been ingested (it must exist as an
UploadedFramework with parsed controls). Defaults to a safe DRY-RUN that writes
nothing and just reports how the framework would slot into the baseline.

Usage (from backend/, with .env loaded):
  # 1) Dry-run report (no DB writes) — recommended first:
  python extend_baseline_cli.py --framework-id 31

  # 2) Build a candidate run (writes a new NormalizationRun, does NOT go live):
  python extend_baseline_cli.py --framework-id 31 --commit

  # 3) Build AND promote to the live baseline (UI updates immediately):
  python extend_baseline_cli.py --framework-id 31 --commit --promote

  --tenant N   (default 1)     --label "..."   custom run label
"""
import argparse
import json
import os
import sys

from dotenv import load_dotenv
load_dotenv(".env")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.modules.control_library.services import extend_baseline as EB


def _session():
    base = os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0]
    return sessionmaker(bind=create_engine(base + "/grc_complyverse"))()


def main() -> int:
    ap = argparse.ArgumentParser(description="Extend the unified-library baseline with a new framework.")
    ap.add_argument("--framework-id", type=int, required=True, help="UploadedFramework id (already ingested)")
    ap.add_argument("--tenant", type=int, default=1)
    ap.add_argument("--commit", action="store_true", help="write a candidate run (default is dry-run)")
    ap.add_argument("--promote", action="store_true", help="with --commit, make it the live baseline")
    ap.add_argument("--label", type=str, default=None)
    args = ap.parse_args()

    db = _session()

    def get_client():
        from grc.modules.control_library.routers.groups import get_openai_client
        return get_openai_client()

    def progress(done, total, msg):
        print(f"  [{done:>3}/{total}] {msg}", file=sys.stderr)

    try:
        if not args.commit:
            print("DRY RUN — no database writes.\n", file=sys.stderr)
            report = EB.analyze(db, args.tenant, args.framework_id, get_client=get_client, progress_cb=progress)
            print(json.dumps(report, indent=2, default=str))
            print(
                f"\nSUMMARY: '{report['framework']}' — {report['new_controls']} controls → "
                f"{report['would_join_existing_set']} join existing sets, "
                f"{report['would_be_standalone']} standalone. Re-run with --commit to build a candidate run.",
                file=sys.stderr,
            )
        else:
            print("COMMIT — building a candidate baseline run…", file=sys.stderr)
            res = EB.commit(db, args.tenant, args.framework_id, get_client=get_client,
                            user_id=1, label=args.label, promote=args.promote, progress_cb=progress)
            print(json.dumps(res, indent=2, default=str))
            if res.get("promoted"):
                print(f"\nPROMOTED — run {res['candidate_run_id']} is now the live baseline. "
                      f"The unified library now includes '{res['added_framework']}'.", file=sys.stderr)
            else:
                print(f"\nCandidate run {res['candidate_run_id']} created (NOT live). "
                      f"Review it, then promote via the product or re-run with --promote.", file=sys.stderr)
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}", file=sys.stderr)
        db.rollback()
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
