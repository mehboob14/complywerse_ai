"""Cross-process event queue for the workflow runtime.

Backed by a Redis list so the API process (which enqueues manual triggers /
test-runs, approval decisions, and resumes) and a SEPARATE worker process
(which runs the runtime loop) share ONE queue. When the runtime runs embedded
in the API this still works; it's just a same-process round-trip through Redis.

Falls back to an in-process ``queue.Queue`` when Redis is unavailable (or when
``WORKFLOW_QUEUE_BACKEND=memory``) so single-process / no-Redis dev still runs —
in that mode a separate worker would NOT see the API's items, by design.
"""
import json
import logging
import os
from queue import Empty, Queue
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Single global list — every item carries its own ``tenant_id``, so one shared
# queue across all tenants is correct and keeps ordering simple.
_REDIS_KEY = "workflow_engine:event_queue"


class WorkflowEventQueue:
    def __init__(self) -> None:
        self._local: Queue = Queue()
        self._redis = None
        self._use_redis = False

        if os.environ.get("WORKFLOW_QUEUE_BACKEND", "redis").strip().lower() == "memory":
            logger.info("workflow.event_queue backend=memory (WORKFLOW_QUEUE_BACKEND=memory)")
            return

        try:
            import redis
            from ....config import REDIS_URL
            client = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=5)
            client.ping()
            self._redis = client
            self._use_redis = True
            logger.info("workflow.event_queue backend=redis key=%s", _REDIS_KEY)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "workflow.event_queue: Redis unavailable (%s) — falling back to in-process queue. "
                "A separate worker will NOT receive API-initiated triggers in this mode.",
                exc,
            )

    def publish(self, item: Dict[str, Any]) -> None:
        if self._use_redis:
            try:
                # LPUSH + RPOP = FIFO.
                self._redis.lpush(_REDIS_KEY, json.dumps(item, default=str))
                return
            except Exception:  # noqa: BLE001
                logger.exception("workflow.event_queue.publish: Redis failed; using local queue")
        self._local.put(item)

    def consume(self, timeout: float = 0.5) -> Optional[Dict[str, Any]]:
        if self._use_redis:
            try:
                raw = self._redis.rpop(_REDIS_KEY)  # non-blocking; matches the runtime's tight drain loop
                if not raw:
                    return None
                return json.loads(raw)
            except Exception:  # noqa: BLE001
                logger.exception("workflow.event_queue.consume: Redis failed")
                return None
        try:
            return self._local.get(timeout=timeout)
        except Empty:
            return None

    def size(self) -> int:
        if self._use_redis:
            try:
                return int(self._redis.llen(_REDIS_KEY))
            except Exception:  # noqa: BLE001
                return 0
        return self._local.qsize()
