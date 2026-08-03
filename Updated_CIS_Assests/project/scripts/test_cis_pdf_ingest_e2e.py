"""End-to-end test against the running backend.

Logs in, uploads the synthetic CIS PDF via the public /api proxy, polls
the job until completion, and verifies the review-queue endpoint
surfaces the auto-generated rules.

Run AFTER the smoke test — it depends on the live Postgres backend.
"""
from __future__ import annotations

import sys
import time
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import requests  # noqa: E402

# Reuse the synthetic PDF builder from the smoke test.
from test_cis_pdf_ingest import build_synthetic_pdf  # noqa: E402

API = "http://localhost:8080/api"  # Express proxy → Python /grc
EMAIL = "info@layeron.com"
PASSWORD = "TestE2E!2026"


def fail(msg: str) -> None:
    print(f"\n[e2e] FAIL — {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    s = requests.Session()
    print("[e2e] login…")
    r = s.post(f"{API}/auth/login", json={"username": EMAIL, "password": PASSWORD}, timeout=15)
    if not r.ok:
        fail(f"login HTTP {r.status_code}: {r.text[:200]}")

    pdf = build_synthetic_pdf()
    print(f"[e2e] uploading {len(pdf)} byte PDF…")
    r = s.post(
        f"{API}/compliance-plugins/ingest",
        files={"file": ("cis-e2e-synthetic.pdf", pdf, "application/pdf")},
        timeout=60,
    )
    if not r.ok:
        fail(f"ingest HTTP {r.status_code}: {r.text[:300]}")
    job = r.json()
    job_id = job.get("id") or job.get("job_id")
    if not job_id:
        fail(f"ingest response missing job id: {job}")
    print(f"[e2e] created job #{job_id}, status={job.get('status')}")

    # Poll until terminal
    for _ in range(30):
        r = s.get(f"{API}/compliance-plugins/ingest/{job_id}", timeout=15)
        if not r.ok:
            fail(f"job poll HTTP {r.status_code}: {r.text[:200]}")
        body = r.json()
        status = (body.get("job") or body).get("status") or body.get("status")
        if status in ("completed", "failed"):
            print(f"[e2e] job terminal — status={status}")
            if status == "failed":
                fail(f"ingest job failed: {body}")
            break
        time.sleep(1)
    else:
        fail("job did not reach terminal status within 30s")

    detail = body if "job" not in body else body
    job_obj = detail.get("job") or detail
    print(f"[e2e] job summary: extracted={job_obj.get('rules_extracted')} "
          f"inserted={job_obj.get('rules_inserted')} updated={job_obj.get('rules_updated')} "
          f"flagged={job_obj.get('rules_flagged')}")

    # List jobs
    r = s.get(f"{API}/compliance-plugins/ingest", timeout=15)
    if not r.ok:
        fail(f"list jobs HTTP {r.status_code}")
    jobs_resp = r.json()
    jobs = jobs_resp.get("jobs") if isinstance(jobs_resp, dict) else jobs_resp
    if not isinstance(jobs, list):
        fail(f"unexpected jobs payload shape: {jobs_resp!r}")
    if not any(j.get("id") == job_id for j in jobs):
        fail(f"job #{job_id} not in list-jobs response (got {len(jobs)} jobs)")
    print(f"[e2e] list-jobs ok — {len(jobs)} job(s) returned")

    # Review queue must include at least the auto-generated rules from this run
    r = s.get(f"{API}/compliance-plugins/review-queue", timeout=15)
    if not r.ok:
        fail(f"review-queue HTTP {r.status_code}: {r.text[:200]}")
    queue_resp = r.json()
    queue = queue_resp.get("plugins") if isinstance(queue_resp, dict) else queue_resp
    if not isinstance(queue, list):
        fail(f"unexpected review-queue payload shape: {queue_resp!r}")
    mine = [p for p in queue if p.get("source_ingest_job_id") == job_id]
    if len(mine) < 2:
        fail(f"review queue did not include this job's auto-generated rules "
             f"(got {len(mine)} mine of {len(queue)} total)")
    print(f"[e2e] review-queue ok — {len(mine)} of my rules pending review (total queue size {len(queue)})")

    print("\n[e2e] OK — full upload → job → review-queue path works")
    return 0


if __name__ == "__main__":
    sys.exit(main())
