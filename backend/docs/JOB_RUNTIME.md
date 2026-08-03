# Job Runtime — Redis + Celery on GRC-Tenant

> Production-grade asynchronous job processing for the multi-tenant GRC
> platform. Covers architecture, file map, end-to-end task lifecycle,
> concurrency model, and real-world workload scenarios.

---

## 1. Why this exists

The GRC platform serves multiple tenants concurrently. Three things make
synchronous request handling impossible past a small scale:

1. **AI-heavy work** — policy parsing and gap analysis call OpenAI for ~10–60
   seconds per request. Holding an HTTP connection open for that long blocks
   uvicorn workers, exhausts the pool under load, and breaks proxy timeouts
   (Cloudflare hard caps at 100s).
2. **Per-tenant DB connections** — every request opens a session against the
   caller's Postgres database. CPU-bound or I/O-bound work in a request
   handler ties up that session and holds a connection from the per-tenant
   pool.
3. **Cross-process visibility** — when a job's progress is held in a Python
   global dict, only the process that started it can see it. A second uvicorn
   worker hitting `/parse-status` returns "idle" instead of the in-flight
   state. Restart the process and the state is lost.

The job runtime solves all three by moving long-running work to a separate
worker pool, with broker-mediated handoff and Redis-backed shared state.

---

## 2. Component map

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              Browser tab                                   │
│  (acme.localhost:3000 — submits the dispatch request, polls task status)   │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         Next.js dev server                                 │
│  (rewrites /api/* → http://127.0.0.1:4000/grc/*)                           │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                      FastAPI (uvicorn workers, N processes)                │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │  TenantMiddleware — sets request.state.tenant_slug              │      │
│   │     ▼                                                           │      │
│   │  router endpoint                                                │      │
│   │     ▼                                                           │      │
│   │  validate input (cheap, in-process)                             │      │
│   │     ▼                                                           │      │
│   │  task.delay(tenant_slug, ...)   ← 1ms, returns immediately      │      │
│   │     ▼                                                           │      │
│   │  return {"task_id": ..., "status": "queued"}                    │      │
│   └─────────────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ pickle-free JSON over TCP
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    Redis (single instance, 3 databases)                    │
│                                                                            │
│   db 0  →  REDIS_URL          (job_status snapshots, distributed locks,    │
│                                rate-limit token buckets)                   │
│   db 1  →  CELERY_BROKER_URL  (queues: default, parsing, ...)              │
│   db 2  →  CELERY_RESULT_BACKEND (task_id → SUCCESS/FAILURE/result)        │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ workers BRPOP from queues
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    Celery workers (M processes, scale horizontally)        │
│   Each process has:                                                        │
│     - its own per-tenant SQLAlchemy engine cache                           │
│     - its own preloaded models / task bodies                               │
│   Each task:                                                               │
│     1. opens a session against the slug's DB (TenantTask.__call__)         │
│     2. acquires a Redis advisory lock on (tenant, resource)                │
│     3. runs the body                                                       │
│     4. writes status to Redis db 0 + result to Redis db 2                  │
│     5. commits + closes the DB session                                     │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ session.commit()
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    Postgres (per-tenant databases)                         │
│   grc_master   — tenants registry only                                     │
│   grc_acme     — tenant DB (all 217 operational tables)                    │
│   grc_layeron  — tenant DB                                                 │
│   grc_<slug>   — tenant DB                                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

The whole runtime fits the **shared-nothing** model. Workers never share
process state with each other or with uvicorn — they communicate only
through Redis and Postgres.

---

## 3. File map

| Path | Role |
|---|---|
| [grc/celery_app.py](../grc/celery_app.py) | Celery `Celery(...)` instance, broker/backend URLs from env, queues, time limits, retry config, signal handlers (logging, prerun/postrun, worker_process_init that preloads heavy modules). |
| [grc/tasks/base.py](../grc/tasks/base.py) | `TenantTask` (Celery base class enforcing `tenant_slug` as the first arg, opens/commits/rolls-back/closes a tenant session), `tenant_lock` (Redis advisory lock with owner-based reclaim), `tenant_rate_limit` (per-tenant per-bucket sliding window), `ping_tenant` (diagnostic). |
| [grc/tasks/governance.py](../grc/tasks/governance.py) | `parse_policy_document`, `run_gap_analysis` task wrappers around the existing pure-Python bodies in `policy_parser._parse_policy_body` and `gap_analysis._gap_analysis_body`. |
| [grc/tasks/frameworks.py](../grc/tasks/frameworks.py) | `parse_framework`, `enhance_framework_controls`, `generate_evidence_requirements` task wrappers around the existing bodies in `framework_upload/parser`. |
| [grc/job_status.py](../grc/job_status.py) | Redis-backed, tenant-namespaced job status helpers (`set_status`, `get_status`, `update_status`, `delete_status`). Replaces the per-process `_parsing_status` global dict. |
| [grc/routers/tasks_router.py](../grc/routers/tasks_router.py) | `GET /tasks/{id}` and `POST /tasks/{id}/revoke`. Tenant-scoped: returns 404 if a tenant tries to see another tenant's task. |
| [grc/db.py](../grc/db.py) | `open_tenant_session(slug)` is what `TenantTask` calls; the same per-tenant engine cache used by the FastAPI request path. Workers and uvicorn share zero in-process state, but they share the connection-pool design. |
| [scripts/start_celery_worker.sh](../scripts/start_celery_worker.sh) | Linux/WSL launcher. Uses prefork pool (real concurrency). |
| [scripts/start_celery_worker.bat](../scripts/start_celery_worker.bat) | Windows launcher. Uses solo pool (no prefork on Windows). |
| [scripts/start_celery_beat.sh](../scripts/start_celery_beat.sh) | Periodic-task scheduler. Currently a stub for future use. |
| [.env](../.env) | `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `TENANT_JOB_RATE_PER_MIN`. |

### Dispatch sites (where the FastAPI side hands off to Celery)

| Endpoint | Task | Lock key | Rate-limit bucket |
|---|---|---|---|
| `POST /governance/documents/{id}/parse-policy` | `governance.parse_policy_document` | `policy_parse:{doc_id}` | `governance_parse` |
| `POST /governance/gap-analysis/run` | `governance.run_gap_analysis` | `gap_analysis:{doc_id}` | `gap_analysis` |
| `POST /framework-upload/{id}/parse` | `frameworks.parse_framework` | `framework_parse:{id}` | `framework_parse` |
| `POST /framework-upload/{id}/retry-parse` | `frameworks.parse_framework` | `framework_parse:{id}` | `framework_parse` |
| `POST /framework-upload/frameworks/{id}/enhance` | `frameworks.enhance_framework_controls` | `framework_enhance:{id}` | `framework_enhance` |
| `POST /framework-upload/{id}/generate-evidence-requirements` | `frameworks.generate_evidence_requirements` | `framework_evidence_reqs:{id}` | `framework_evidence_reqs` |

---

## 4. End-to-end task lifecycle

This is what happens when a user clicks "Parse policy" on a document.

### 4.1 Browser → FastAPI

```
Browser (acme.localhost:3000)
  │
  │  POST /api/governance/documents/123/parse-policy
  │  Cookie: grc_auth_token=eyJ…
  │  X-Tenant-Slug: acme
  ▼
Next.js rewrite → http://127.0.0.1:4000/grc/governance/documents/123/parse-policy
```

### 4.2 Middleware sets tenant context

```python
# grc/middleware/subdomain.py
class TenantMiddleware:
    async def dispatch(request, call_next):
        # Resolution order: subdomain → X-Tenant-Slug header → JWT cookie.
        # Looks up the tenant in grc_master.grc_tenants.
        request.state.tenant_slug = "acme"
        request.state.tenant = {"id": 1, "slug": "acme", ...}
```

### 4.3 Endpoint validates input (cheap)

```python
# grc/modules/governance/routers/policy_parser.py
@router.post("/{document_id}/parse-policy")
def parse_policy_document(document_id, request, db, current_user):
    tenant_slug = request.state.tenant_slug                      # "acme"
    document = db.query(GovernanceDocument).filter(...).first()  # in tenant DB
    if not document: raise HTTPException(404, ...)               # fast fail

    # Per-tenant rate limit (Redis token bucket).
    tenant_rate_limit(tenant_slug, bucket="governance_parse")

    # 1ms — pushes a JSON message onto the parsing queue in Redis db 1.
    async_result = parse_policy_document.delay(tenant_slug, document_id, current_user.id)

    return {"task_id": async_result.id, "status": "queued"}
```

The HTTP response is sent in <50 ms. **The user is not waiting on OpenAI.**

### 4.4 Redis broker (db 1) — message in flight

```
LPUSH parsing  '{"id":"abc-123","task":"grc.tasks.governance.parse_policy_document",
                "args":["acme",123,7],"kwargs":{},...}'
```

The message stays in Redis until a worker pops it. Even if uvicorn crashes
**right now**, the message survives.

### 4.5 Worker picks up the message

```
worker process (Celery prefork pool)
  │
  ├── BRPOP parsing            ← pulls message from Redis db 1
  ├── deserialize JSON
  ├── TenantTask.__call__      ← validates "acme" slug
  │     └── opens session against grc_acme DB
  ├── parse_policy_document(self, "acme", 123, 7, db=<session>)
  │     ├── tenant_lock(slug, "policy_parse:123", owner=task_id)
  │     │     └── SET lock:acme:policy_parse:123 <task_id> NX EX 1800
  │     ├── job_status.set_status("acme", "policy_parse", 123, {"status": "parsing"})
  │     ├── _parse_policy_body(db, 123, 7, "acme")
  │     │     └── (calls OpenAI, writes PolicyStatement rows, ~30s)
  │     └── return {"status": "completed", "total_statements": 42}
  ├── TenantTask: db.commit(); db.close()
  └── Celery: store result in Redis db 2 + DEL the lock + ack the message
```

### 4.6 Browser polls for status

```
Browser → GET /api/tasks/abc-123     (or the legacy /parse-status/{doc_id})
            │
            ▼
        FastAPI tasks_router
            │
            ├── celery.AsyncResult("abc-123") reads Redis db 2
            └── returns {"state": "SUCCESS", "result": {"status": "completed", ...}}
```

When the worker finishes, the next poll returns the terminal state. The
browser reflects "Parsed 42 statements" and stops polling.

### 4.7 Failure paths

- **Worker crashes mid-task** — the broker hasn't received an ack
  (`task_acks_late=True`), so the message is redelivered to another worker.
  When the redelivered task runs, it sees a still-held lock from the dead
  worker, but the `owner=self.request.id` matches (Celery preserves the task
  id across redelivery), so the new worker **reclaims** the lock and resumes.
- **Body raises an exception** — `autoretry_for=(Exception,)` re-queues with
  exponential backoff. After `max_retries=3` total attempts the task moves
  to `FAILURE` state. `_parsing_status` and Redis `job_status` are both set
  to `{"status": "failed", "error": ...}`.
- **OpenAI returns 429** — bubbles up as exception, retry kicks in. The
  `retry_backoff_max=600` cap means the third retry waits up to 10 min.
- **Redis is unreachable** — `.delay()` raises in the FastAPI endpoint; the
  user sees a 503. No silent loss.
- **Task runs longer than 20 min** — `task_time_limit=20m` kills the worker
  child. Lock TTL releases after 30 min. The user sees `state=FAILURE`.

---

## 5. Concurrency model

### 5.1 The unit of parallelism

| Process | What it does | Scale by |
|---|---|---|
| uvicorn worker | Serves HTTP requests, dispatches tasks. | `--workers N` (default = CPU count). |
| Celery worker | Consumes tasks from broker queues, runs the bodies. | More processes, OR `--concurrency=M` per process for prefork pool. |
| Celery beat | Single, cluster-wide scheduler for periodic tasks. | Exactly one instance. |

### 5.2 Per-process state

Each uvicorn worker AND each Celery worker maintains:

- A per-tenant SQLAlchemy engine cache (`grc.db._tenant_engines`). Lazy:
  the engine is created the first time the process touches a given tenant.
- A per-tenant `sessionmaker`.
- A Redis client (process-local, but the connection pool is thread-safe).

This means **no state is shared across processes**. Two workers can run
the same tenant's tasks simultaneously without coordinating; they both
open independent connections to the same Postgres DB.

### 5.3 Per-tenant connection pool sizing

A Postgres database has a max-connection limit (default 100). With per-tenant
pools, the formula is:

```
total_pg_conns_per_tenant
    ≤ (uvicorn workers + celery worker children)
      × pool_size_per_engine
```

Default SQLAlchemy `pool_size=5` + `max_overflow=10` means each engine can
hold up to 15 connections. For 4 uvicorn workers × 8 celery prefork children
= 12 processes × 15 = **180 connections per tenant**. Postgres default of
100 is too low for that — bump `max_connections` in `postgresql.conf` or
lower the pool sizes if you'll have many tenants under load.

### 5.4 Queue routing & worker fanout

```python
# celery_app.py
task_routes = {
    "grc.tasks.frameworks.*":                          {"queue": "parsing"},
    "grc.tasks.governance.parse_policy_document":      {"queue": "parsing"},
    "grc.tasks.governance.run_gap_analysis":           {"queue": "parsing"},
    # everything else → "default"
}
```

Recommended deployment:

```bash
# Two pools, scale independently:

# Long AI tasks (1-2 instances, lots of concurrency)
QUEUES=parsing CONCURRENCY=8 bash scripts/start_celery_worker.sh

# Short tasks (more instances, less concurrency each)
QUEUES=default CONCURRENCY=4 bash scripts/start_celery_worker.sh
```

`worker_prefetch_multiplier=1` ensures workers only reserve one message at a
time. A long parsing job won't lock several short-job messages in its prefetch
buffer ahead of itself, so other tenants stay responsive.

### 5.5 Per-tenant fairness

Celery doesn't natively schedule per-tenant fairly. Two safeguards:

1. **`tenant_rate_limit`** — token-bucket in Redis, default 120 dispatches
   per minute per (tenant, bucket). A tenant that hammers `parse-policy`
   gets HTTP 429 from FastAPI before a single message reaches the broker.
2. **Workers compete fairly within a queue** — with `prefetch_multiplier=1`,
   no single tenant can fill a worker's prefetch and block others. The next
   message picked up is whichever tenant's was at the head of the queue.

For stronger isolation (e.g. a paid-tier tenant should never wait behind a
free-tier tenant's job), introduce a per-tier queue:

```python
# Future enhancement
task_routes = {
    "grc.tasks.governance.*": lambda name, args, kwargs, options, task=None, **_:
        {"queue": "parsing-priority" if _is_priority(args[0]) else "parsing-default"}
}
```

…and run separate worker pools for `parsing-priority` and `parsing-default`.

---

## 6. Workload profiles & timing

| Profile | Examples | Median latency | Where it runs | Why |
|---|---|---|---|---|
| **Quick** (<200 ms) | Fetch risks, list controls, /me | ~50 ms | uvicorn, synchronous | Cheap DB query; user is staring at the screen. No need for a queue. |
| **Medium** (1–10 s) | Generate AI policy draft, score a single risk via LLM, validate evidence text | ~3–8 s | uvicorn, **async I/O** to OpenAI inside the request | Fits inside a normal HTTP timeout. UX expects a brief spinner. |
| **Heavy** (10–120 s) | Parse a full policy doc (20-page PDF), gap-analyse a doc against 5 frameworks, parse an uploaded framework | 30–90 s | **Celery worker** | Exceeds proxy timeouts; tenant-isolation matters; user expects progress polling. |
| **Background** (minutes–hours) | Batch enhance all controls, embed all evidence for chatbot, run AI on every framework | 5–30 min | **Celery worker (parsing queue, possibly with `task_soft_time_limit` raised)** | Scheduled or user-initiated, status-tracked, fully asynchronous. |

### 6.1 Why "medium" stays in uvicorn

A 5-second OpenAI call inside a FastAPI handler is fine — uvicorn's worker
just blocks for 5 s on that one request, but other requests on other workers
are unaffected. The threshold for moving to Celery is when:

1. The work routinely exceeds proxy/CDN timeouts (Cloudflare 100 s, AWS ALB
   60 s default).
2. The user shouldn't have to keep the browser tab open (long-running parse).
3. The work could be retried automatically on failure.
4. Multiple tenants would compete unfairly for uvicorn workers.

If a "medium" task starts hitting (1) or (3) under real load, move it to
Celery — the wrapper is a 5-line addition.

### 6.2 Concrete numbers from this project

Measured on this dev machine (Windows, Postgres on port 5433, Redis on WSL):

| Operation | First (cold) | Subsequent (warm) |
|---|---|---|
| `ping_tenant.delay(slug)` round-trip | 60 ms | 60 ms |
| `parse_policy_document.delay(...)` non-existent doc | 2.7 s | 100 ms |
| Real document parse (20-page PDF, 3 chunks) | ~45 s | ~45 s |
| Gap analysis vs ISO 27001 (93 controls) | ~60 s | ~60 s |
| Framework parse (50-page regulatory doc) | ~3 min | ~3 min |

The "first cold" overhead is one-time per worker process — it's the time
to import `grc.models`, `policy_parser`, etc. We do this **eagerly** at
worker boot via `worker_process_init`, so the first user-facing dispatch
is already warm.

---

## 7. Real-world scenario: 3 tenants, 5 users, mixed workloads

A concrete timeline showing how the system behaves under realistic
concurrent load.

### Setup

- **2 uvicorn workers** (Windows, port 4000)
- **1 Celery worker** with `--concurrency=4` (prefork on WSL)
- **3 active tenants**: `acme`, `globex`, `initech`
- **5 simultaneous users**, all sending different operations

### Timeline (HH:MM:SS)

```
14:00:00.000  alice@acme       → POST /risks                            (Quick)
14:00:00.020  bob@globex       → GET  /controls                         (Quick)
14:00:00.500  carol@initech    → POST /governance/documents/9/parse-policy  (Heavy)
14:00:00.700  alice@acme       → POST /governance/gap-analysis/run       (Heavy)
14:00:01.200  dave@globex      → POST /framework-upload/3/parse          (Heavy)
14:00:01.300  eve@acme         → GET  /tasks/{carol_task_id}             (Quick: NOT theirs!)
14:00:02.000  bob@globex       → GET  /risks                             (Quick)
```

### What each request does

```
14:00:00.000  alice's POST /risks
  │  uvicorn worker A picks up the request
  │  middleware: tenant_slug = "acme"
  │  Depends(get_db) → opens session against grc_acme
  │  insert Risk row, commit, return 201
  └─ DONE at 14:00:00.080  (80 ms)

14:00:00.020  bob's GET /controls
  │  uvicorn worker B picks up the request
  │  middleware: tenant_slug = "globex"
  │  Depends(get_db) → opens session against grc_globex
  │  query, return 200
  └─ DONE at 14:00:00.060  (40 ms)

14:00:00.500  carol's POST .../parse-policy
  │  uvicorn worker A picks up the request
  │  validate: doc 9 exists in grc_initech, user is admin
  │  rate-limit check (initech, governance_parse) → OK
  │  parse_policy_document.delay("initech", 9, 12)
  │     └── pushes message to Redis db 1, queue=parsing
  │  return {"task_id": "t-AAAA", "status": "queued"}
  └─ DONE at 14:00:00.560  (60 ms)
                       │
                       ▼ (message sits in Redis until a worker pops it)
                       │
14:00:00.610  Celery worker child #1
  │  BRPOP parsing → got message t-AAAA
  │  TenantTask: open_tenant_session("initech")
  │  acquire lock:initech:policy_parse:9
  │  set_status("initech", "policy_parse", 9, {status: "parsing"})
  │  _parse_policy_body(db, 9, 12, "initech")
  │  (OpenAI calls, ~40 s of work)

14:00:00.700  alice's POST .../gap-analysis/run
  │  uvicorn worker B
  │  rate-limit check (acme, gap_analysis) → OK
  │  run_gap_analysis.delay("acme", [run_id1, run_id2], 5, 7)
  │  return {"task_id": "t-BBBB", "status": "queued"}
  └─ DONE at 14:00:00.770  (70 ms)
                       │
                       ▼
14:00:00.820  Celery worker child #2
  │  BRPOP parsing → got message t-BBBB
  │  TenantTask: open_tenant_session("acme")
  │     ← different tenant! independent connection pool, independent DB
  │  acquire lock:acme:gap_analysis:5
  │  _gap_analysis_body(...)
  │  (OpenAI calls, ~60 s)

14:00:01.200  dave's POST .../framework-upload/3/parse
  │  uvicorn worker A
  │  parse_framework.delay("globex", 3, "/uploads/...", "pdf", "GDPR")
  │  return {"status": "queued"}
  └─ DONE at 14:00:01.290  (90 ms)
                       │
                       ▼
14:00:01.350  Celery worker child #3
  │  BRPOP parsing → got message
  │  open_tenant_session("globex")
  │  acquire lock:globex:framework_parse:3
  │  _run_background_parsing_body(...)
  │  (PDF extraction + chunked OpenAI calls, ~3 min)

14:00:01.300  eve's GET /tasks/t-AAAA  (carol's task!)
  │  uvicorn worker B
  │  middleware: tenant_slug = "acme" (eve's tenant)
  │  GET task t-AAAA via AsyncResult
  │  task.args[0] = "initech"  ≠ "acme"
  │  raise 404 "Task not found"     ← cross-tenant isolation
  └─ DONE at 14:00:01.330  (30 ms)

14:00:02.000  bob's GET /risks
  │  uvicorn worker A
  │  Note: workers A and B both serve this request type.
  │        Postgres session pool for grc_globex is busy with bob's
  │        previous request still settling — pool returns a fresh conn
  │        from max_overflow.
  │  query, return 200
  └─ DONE at 14:00:02.040  (40 ms)
```

### Worker pool state at 14:00:02.5

- **uvicorn worker A**: idle (carol's request finished, dave's finished)
- **uvicorn worker B**: idle (alice's, eve's, bob's all finished)
- **Celery child #1**: busy on `t-AAAA` (initech parse-policy, ~40s left)
- **Celery child #2**: busy on `t-BBBB` (acme gap-analysis, ~58s left)
- **Celery child #3**: busy on dave's framework parse (~3 min left)
- **Celery child #4**: idle, BRPOP-blocked

If a 6th user lands a new heavy job at 14:00:03, child #4 picks it up
**instantly**. All three running heavy jobs continue undisturbed because they
each have their own DB connection, their own OpenAI client, and their own
process. They're isolated by tenant, and tenants can't see each other's
data because the DB sessions are bound to different physical Postgres
databases.

### Why uvicorn stays responsive

At 14:00:02 there are three heavy jobs running concurrently. **None of them
is touching uvicorn.** The two uvicorn workers spent <100 ms each handling
the dispatch and went back to idle. They're free to serve eve's
status-poll, bob's risk fetch, alice's next page navigation — all the
quick interactions that make the UI feel snappy.

---

## 8. Operational guide

### 8.1 Bring-up

```bash
# Terminal 1 — Redis (already running)
service redis-server status   # active

# Terminal 2 — Postgres (already running)
service postgresql status

# Terminal 3 — uvicorn
cd /mnt/c/Users/Admin/Documents/GRC-Tenant/backend
python -m uvicorn main:app --port 4000 --workers 4

# Terminal 4 — Celery worker (parsing queue, real concurrency)
cd /mnt/c/Users/Admin/Documents/GRC-Tenant/backend
QUEUES=parsing CONCURRENCY=8 bash scripts/start_celery_worker.sh

# Terminal 5 (optional) — Celery worker (default queue, more workers)
QUEUES=default CONCURRENCY=4 bash scripts/start_celery_worker.sh
```

### 8.2 Scale out

Adding a worker is a one-liner — start another one on the same or a
different machine that can reach Redis:

```bash
# On a second machine (or same machine, different terminal)
QUEUES=parsing CONCURRENCY=8 bash scripts/start_celery_worker.sh
# Now you have 16 concurrent parsing slots.
```

No code change. No deployment. The new worker subscribes to the queue,
pulls its share of messages, and starts processing.

### 8.3 Inspect & debug

```python
# scripts/inspect_jobs.py — ad hoc, run from the backend dir

from celery.result import AsyncResult
from grc.celery_app import celery_app

# Status of a specific task
AsyncResult("abc-123", app=celery_app).state

# Active tasks across all workers
celery_app.control.inspect().active()

# Stats per worker
celery_app.control.inspect().stats()
```

Or via shell:

```bash
celery -A grc.celery_app inspect active
celery -A grc.celery_app inspect stats
celery -A grc.celery_app inspect reserved
celery -A grc.celery_app status
```

For real-time monitoring, install Flower:

```bash
pip install flower
celery -A grc.celery_app flower --port=5555
# open http://localhost:5555
```

### 8.4 Revoke a stuck task

```bash
# From the API (preferred — enforces tenant scope)
curl -X POST -H "X-Tenant-Slug: acme" -H "Authorization: Bearer ..." \
     http://127.0.0.1:4000/grc/tasks/abc-123/revoke

# Or via Celery directly (no tenant check)
celery -A grc.celery_app control revoke abc-123 --terminate
```

### 8.5 Clear stuck Redis state (DEV ONLY)

```python
import redis
for db in (0, 1, 2):
    redis.Redis.from_url(f"redis://127.0.0.1:6379/{db}").flushdb()
```

**Never run this in production** — it nukes every in-flight task's lock
and result, causing duplicate work and lost state.

### 8.6 Monitoring checklist

| Signal | Where | Threshold | Why |
|---|---|---|---|
| Redis memory used | `redis-cli info memory` | <70% of `maxmemory` | Result backend keeps results 24 h; spikes can fill RAM. |
| Queue depth (parsing) | `redis-cli -n 1 llen parsing` | <100 backlog | Indicates not enough workers for the load. |
| Worker count | `celery inspect stats` | At least 1 per queue | A queue with no consumer = stuck jobs. |
| Task failure rate | Celery events / Flower | <5% over 1 h | Spike usually means OpenAI 429 or DB connection exhaustion. |
| Postgres connections | `pg_stat_activity` | <80% of `max_connections` | Pool storms when workers + uvicorn both scale. |

### 8.7 Failure recovery

| Failure | Detection | Recovery |
|---|---|---|
| Worker process crashes mid-task | Task message un-acked; visible in `inspect reserved` | Broker redelivers the message; lock reclaimed by same task id; task resumes. |
| All workers die | Queue depth keeps growing; `inspect stats` returns empty | Restart workers; queued messages resume immediately. |
| Redis dies | `.delay()` raises `ConnectionError`; uvicorn returns 503 | Restart Redis; queued messages were lost (use AOF persistence in prod). |
| Postgres tenant DB unreachable | `TenantTask.__call__` raises `OperationalError`; task retries (autoretry_for=Exception) | After 3 retries, task moves to FAILURE; status surfaced in UI. |
| OpenAI rate-limited | `openai.RateLimitError` bubbles up | Celery retries with exponential backoff (max 10 min). After 3 failures, task FAILURE. |

---

## 9. Decision record

Choices made and the alternatives considered, kept short.

- **Celery vs RQ vs Arq.** Celery — most mature feature set (retries, beat,
  routing, signals), used in production at scale, broad ecosystem. RQ would
  be simpler but lacks routing flexibility. Arq is async-native but our
  task bodies are sync (SQLAlchemy ORM is sync), so async would mean
  thread-pooling everything anyway.
- **Redis vs RabbitMQ.** Redis — already deployed for caching/locks,
  one less moving part. RabbitMQ is more durable under broker restarts but
  requires a separate operational surface. With Redis AOF persistence the
  durability gap closes.
- **Three Redis DBs vs one.** Three — keeps locks, broker, and results in
  separate keyspaces. `FLUSHDB` on the broker doesn't nuke locks. `KEYS *`
  during debugging is scoped.
- **Per-tenant queues vs shared queues with rate limit.** Shared with
  rate limit — simpler operationally, fairer for typical loads. Per-tenant
  queues become necessary only at large multi-tenant scale (hundreds of
  tenants) and can be added incrementally.
- **`task_acks_late=True`.** A worker crash mid-task must redeliver the
  message. The trade-off is duplicate work if the task is non-idempotent;
  every task body in this codebase is wrapped in a `tenant_lock` to enforce
  idempotency.
- **`worker_prefetch_multiplier=1`.** Without this, workers reserve a buffer
  of messages on connect. A slow tenant's job in the buffer would block
  other tenants' fast jobs from being delivered. Setting to 1 = "give me
  one job at a time" = fairness.
- **`task_track_started` not enabled.** Adds extra Redis writes per task.
  We don't need STARTED state — task transitions PENDING → SUCCESS/FAILURE
  for the cases we care about.

---

## 10. What's next (deferred)

- **Retenant-aware the workflow runtime.** Currently disabled
  (`DISABLE_EMBEDDED_WORKFLOW_RUNTIME=1`). Re-enable as a Celery beat
  scheduled job that fans out per active tenant.
- **Retenant-aware the chatbot embedding worker.** Same pattern.
- **Move evidence OCR to Celery.** Last in-process `threading.Thread` in a
  user-facing route, in [evidence/router.py](../grc/modules/evidence/routers/evidence.py).
- **Per-tier queues** for paid-vs-free isolation when commercial tiers exist.
- **Result backend cleanup beat task** — `result_expires=24h` only
  expires keys after a worker reaps them; an explicit periodic cleanup
  would tidy results faster under high churn.
- **Flower in dev compose** — make `flower` part of `docker-compose.yml`
  for an instant monitoring UI on every dev environment.
