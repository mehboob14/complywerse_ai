"""
Base task class + concurrency primitives for tenant-aware Celery tasks.

`TenantTask` enforces the contract that **every** background job carries a
tenant slug. The task receives a tenant-scoped SQLAlchemy session that is
opened on entry and closed on exit, with rollback on exception.

`tenant_lock` is a Redis-backed advisory lock used to serialize work that
must not run twice concurrently (e.g. parsing the same document a second
time while the first is still running).

`tenant_rate_limit` is a sliding-window token-bucket implemented in Redis,
used to bound how often a single tenant can dispatch heavy jobs.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator, Optional

import redis
from celery import Task
from sqlalchemy.orm import Session

from ..config import REDIS_URL
from ..db import open_tenant_session, validate_slug

logger = logging.getLogger(__name__)


# ─── Shared Redis client (lazy) ───────────────────────────────────────────────

_redis_client: Optional[redis.Redis] = None


def get_redis() -> redis.Redis:
    """Process-local Redis client. Each Celery worker / uvicorn worker has its
    own instance — `redis-py` connection pools are thread-safe."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=5)
    return _redis_client


# ─── Distributed lock ────────────────────────────────────────────────────────

class LockNotAcquired(Exception):
    """Raised when a tenant_lock can't be acquired within `blocking_timeout`."""


@contextmanager
def tenant_lock(
    tenant_slug: str,
    resource: str,
    *,
    ttl_seconds: int = 1800,
    blocking_timeout: float = 0.0,
    owner: Optional[str] = None,
) -> Iterator[str]:
    """Acquire a Redis advisory lock scoped to (tenant, resource).

    Args:
        tenant_slug: caller's tenant.
        resource: arbitrary resource id (e.g. f"document:{id}").
        ttl_seconds: lock auto-expires after this many seconds — a hard
            ceiling so a crashed worker doesn't leak the lock forever.
        blocking_timeout: how long to wait if another process holds the lock.
            0 = non-blocking; raise immediately if held.
        owner: stable identifier of the caller. If a previous holder with the
            same `owner` already owns the lock (e.g. Celery task retry after
            the worker crashed), the lock is reclaimed instead of blocked.
            Recommended: pass `self.request.id` from a Celery task so retries
            of the same task can resume.

    Usage:
        with tenant_lock("acme", f"document:{doc_id}", owner=self.request.id):
            ... run idempotent work ...
    """
    validate_slug(tenant_slug)
    key = f"lock:{tenant_slug}:{resource}"
    token = owner or uuid.uuid4().hex
    r = get_redis()
    deadline = time.monotonic() + blocking_timeout
    while True:
        # Fast path: nobody holds the lock; we take it.
        if r.set(key, token, nx=True, ex=ttl_seconds):
            break
        # Reclaim path: same owner already holds the lock — refresh TTL and proceed.
        if owner:
            current = r.get(key)
            if current == owner:
                r.expire(key, ttl_seconds)
                logger.info("tenant_lock reclaimed by same owner key=%s owner=%s", key, owner[:8])
                break
        if time.monotonic() >= deadline:
            raise LockNotAcquired(f"could not acquire {key}")
        time.sleep(0.1)
    try:
        yield token
    finally:
        # Compare-and-delete: only release the lock if we still own it.
        # Avoids deleting a lock another process re-acquired after our TTL
        # expired.
        lua = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"
        try:
            r.eval(lua, 1, key, token)
        except Exception:
            logger.exception("tenant_lock release failed for %s", key)


# ─── Per-tenant rate limit ────────────────────────────────────────────────────

class RateLimitExceeded(Exception):
    """Raised when a tenant exceeds their per-minute job dispatch budget."""


def tenant_rate_limit(tenant_slug: str, *, bucket: str = "jobs", limit_per_min: Optional[int] = None) -> None:
    """Token-bucket rate limit. Raises `RateLimitExceeded` if the tenant has
    consumed more than `limit_per_min` requests in the last 60s.

    Default limit is read from `TENANT_JOB_RATE_PER_MIN` env (defaults to 120).
    Set to 0 to disable.
    """
    if limit_per_min is None:
        limit_per_min = int(os.getenv("TENANT_JOB_RATE_PER_MIN", "120"))
    if limit_per_min <= 0:
        return
    validate_slug(tenant_slug)
    r = get_redis()
    key = f"rl:{bucket}:{tenant_slug}"
    pipe = r.pipeline()
    pipe.incr(key)
    pipe.expire(key, 60)
    count, _ = pipe.execute()
    if int(count) > limit_per_min:
        raise RateLimitExceeded(f"tenant={tenant_slug} bucket={bucket} count={count}/{limit_per_min}")


# ─── Tenant-aware Task base class ─────────────────────────────────────────────

class TenantTask(Task):
    """Celery base class that opens a per-tenant SQLAlchemy session and passes
    it to the task body via the `db` kwarg.

    Tasks subclassing this MUST take `tenant_slug: str` as their first positional
    argument. The base class:
        1. Validates the slug (defends against poisoned queue messages).
        2. Opens an `open_tenant_session(slug)` session.
        3. Calls the task body with `db=<session>` injected.
        4. Commits on success, rolls back on exception, always closes.

    Use it like:

        @celery_app.task(base=TenantTask, bind=True)
        def my_task(self, tenant_slug: str, doc_id: int, db: Session = None):
            doc = db.query(Document).get(doc_id)
            ...

    The `db` keyword arg is filled in by `__call__`; routes that dispatch the
    task should call it as `my_task.delay(tenant_slug, doc_id)`.
    """

    abstract = True

    # Built-in retry: any uncaught exception triggers a retry with exponential
    # backoff, capped at `max_retries` total attempts.
    autoretry_for = (Exception,)
    retry_backoff = True
    retry_backoff_max = 600   # cap each retry at 10 minutes
    retry_jitter = True
    max_retries = 3

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        if not args:
            raise ValueError(f"{self.name} called without tenant_slug as first arg")
        tenant_slug = args[0]
        if not isinstance(tenant_slug, str) or not tenant_slug:
            raise ValueError(f"{self.name}: tenant_slug must be a non-empty string, got {tenant_slug!r}")
        validate_slug(tenant_slug)

        # Already injected? (e.g. test calls run() directly with db= already set.)
        if "db" in kwargs and kwargs["db"] is not None:
            return super().__call__(*args, **kwargs)

        db: Session = open_tenant_session(tenant_slug)
        try:
            kwargs["db"] = db
            result = super().__call__(*args, **kwargs)
            db.commit()
            return result
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


__all__ = ["TenantTask", "tenant_lock", "tenant_rate_limit", "LockNotAcquired", "RateLimitExceeded", "get_redis", "ping_tenant"]


# ─── Diagnostic / health-check task ─────────────────────────────────────────

def _register_diagnostic_tasks():
    """Register a tenant-scoped ping task. Used by smoke tests + ops health
    checks to confirm: (a) broker is reachable, (b) at least one worker is
    consuming the queue, (c) per-tenant DB sessions can be opened.
    """
    from ..celery_app import celery_app

    @celery_app.task(base=TenantTask, bind=True, name="grc.tasks.base.ping_tenant", max_retries=0)
    def ping_tenant(self, tenant_slug: str, db: Session = None) -> dict:
        # Verify the session works by issuing a trivial query.
        from sqlalchemy import text as _text
        row = db.execute(_text("SELECT current_database() AS db, now() AS ts")).first()
        return {
            "tenant_slug": tenant_slug,
            "db": row[0] if row else None,
            "ts": row[1].isoformat() if row else None,
            "task_id": self.request.id,
        }

    return ping_tenant


ping_tenant = _register_diagnostic_tasks()
