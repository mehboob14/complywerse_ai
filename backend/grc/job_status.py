"""
Redis-backed, tenant-scoped job status store.

Replaces the per-process global dicts (`_parsing_status`, `_reparse_proposals`,
etc.) that were lost on restart and never visible to other processes. State now
lives in Redis under a tenant-namespaced key, so:

  * Multiple uvicorn workers see the same state.
  * Celery workers update state and HTTP handlers read it.
  * State survives a restart (until TTL).
  * Tenants are strictly isolated by key prefix.

Each entry has a default TTL so old jobs eventually disappear.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional

import redis

from .db import validate_slug

logger = logging.getLogger(__name__)


_TTL_SECONDS = int(os.getenv("JOB_STATUS_TTL_SECONDS", str(7 * 24 * 60 * 60)))  # 7 days


_redis_client: Optional[redis.Redis] = None


def _get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
        _redis_client = redis.Redis.from_url(url, decode_responses=True, socket_timeout=5)
    return _redis_client


def _key(tenant_slug: str, namespace: str, resource_id: Any) -> str:
    validate_slug(tenant_slug)
    return f"jobstatus:{tenant_slug}:{namespace}:{resource_id}"


def set_status(tenant_slug: str, namespace: str, resource_id: Any, status: Dict[str, Any], *, ttl: Optional[int] = None) -> None:
    """Write a status snapshot for (tenant, namespace, resource).

    `status` is an arbitrary JSON-serialisable dict — typically contains keys
    like `status`, `message`, `progress_percent`, etc.
    """
    try:
        _get_redis().set(_key(tenant_slug, namespace, resource_id), json.dumps(status), ex=ttl or _TTL_SECONDS)
    except Exception:
        logger.exception("job_status.set failed for %s/%s/%s", tenant_slug, namespace, resource_id)


def get_status(tenant_slug: str, namespace: str, resource_id: Any, *, default: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        raw = _get_redis().get(_key(tenant_slug, namespace, resource_id))
    except Exception:
        logger.exception("job_status.get failed for %s/%s/%s", tenant_slug, namespace, resource_id)
        return default if default is not None else {"status": "unknown"}
    if not raw:
        return default if default is not None else {"status": "idle"}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"status": "unknown"}


def update_status(tenant_slug: str, namespace: str, resource_id: Any, patch: Dict[str, Any], *, ttl: Optional[int] = None) -> Dict[str, Any]:
    """Merge-update a status entry. Reads the current value, applies the patch,
    writes back. Not atomic — callers writing the same key concurrently may
    lose a field. Acceptable for monotonically-progressing status fields."""
    current = get_status(tenant_slug, namespace, resource_id, default={})
    current.update(patch)
    set_status(tenant_slug, namespace, resource_id, current, ttl=ttl)
    return current


def delete_status(tenant_slug: str, namespace: str, resource_id: Any) -> None:
    try:
        _get_redis().delete(_key(tenant_slug, namespace, resource_id))
    except Exception:
        logger.exception("job_status.delete failed")


__all__ = ["set_status", "get_status", "update_status", "delete_status"]
