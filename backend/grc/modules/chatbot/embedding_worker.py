import argparse
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

from ...models import SessionLocal, Tenant, init_grc_db
from .router import (
    _build_vector_catalog,
    _collect_documents_for_matches,
    _sync_docs_to_qdrant,
    get_qdrant_service,
)

logger = logging.getLogger(__name__)
_db_init_attempted = False


def _truthy(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _all_tenant_ids(db: Any) -> List[int]:
    rows = db.query(Tenant.id).order_by(Tenant.id.asc()).all()
    return [int(row[0]) for row in rows]


def sync_embeddings_once(*, force: bool = False, tenant_ids: Optional[List[int]] = None) -> Dict[str, Any]:
    global _db_init_attempted
    if not _db_init_attempted:
        _db_init_attempted = True
        # Ensure latest tables/seed metadata exist when worker is run as a standalone process.
        try:
            init_grc_db()
        except Exception as exc:
            logger.warning("init_grc_db warning before embedding sync: %s", exc)

    service = get_qdrant_service()
    if not service or not getattr(service, "is_available", False):
        return {
            "status": "unavailable",
            "reason": "qdrant_or_openai_not_configured",
            "tenant_count": 0,
            "indexed_documents": 0,
            "indexed_points": 0,
        }

    db = SessionLocal()
    try:
        scoped_tenants = list(tenant_ids or _all_tenant_ids(db))
        if not scoped_tenants:
            return {
                "status": "ok",
                "reason": "no_tenants",
                "tenant_count": 0,
                "indexed_documents": 0,
                "indexed_points": 0,
            }

        total_documents = 0
        total_points = 0
        source_types: set[str] = set()
        failed_tenants: List[int] = []

        for tenant_id in scoped_tenants:
            try:
                catalog = _build_vector_catalog(db, [tenant_id], uploaded_files=[])
                docs = _collect_documents_for_matches(db, [tenant_id], catalog, uploaded_files=[])
                indexed_points = _sync_docs_to_qdrant(service, docs, force=force)

                total_documents += len(docs)
                total_points += indexed_points
                source_types.update(str(doc.source_type) for doc in docs if getattr(doc, "source_type", ""))
            except Exception as tenant_exc:
                db.rollback()
                failed_tenants.append(int(tenant_id))
                logger.warning("Embedding sync skipped for tenant %s due error: %s", tenant_id, tenant_exc)
                continue

        return {
            "status": "ok",
            "tenant_count": len(scoped_tenants),
            "indexed_documents": total_documents,
            "indexed_points": total_points,
            "source_types": sorted(source_types),
            "failed_tenants": failed_tenants,
            "force": force,
        }
    finally:
        db.close()


class ComplyChatEmbeddingWorker:
    def __init__(self) -> None:
        self.interval_seconds = max(30, int(os.getenv("COMPLYCHAT_EMBED_WORKER_INTERVAL_SECONDS") or "120"))
        self.force_first_sync = _truthy(os.getenv("COMPLYCHAT_EMBED_WORKER_FORCE_FIRST_SYNC") or "true")
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="complychat-embedding-worker")
        self._thread.start()
        logger.info(
            "ComplyChat embedding worker started (interval=%ss, force_first_sync=%s)",
            self.interval_seconds,
            self.force_first_sync,
        )

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        logger.info("ComplyChat embedding worker stopped")

    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive() and not self._stop_event.is_set())

    def _run_loop(self) -> None:
        first_cycle = True
        while not self._stop_event.is_set():
            force = self.force_first_sync and first_cycle
            try:
                summary = sync_embeddings_once(force=force)
                logger.info(
                    "ComplyChat embedding sync complete: tenants=%s docs=%s points=%s force=%s status=%s",
                    summary.get("tenant_count"),
                    summary.get("indexed_documents"),
                    summary.get("indexed_points"),
                    force,
                    summary.get("status"),
                )
            except Exception as exc:
                logger.exception("ComplyChat embedding sync failed: %s", exc)
            first_cycle = False
            self._stop_event.wait(self.interval_seconds)


_runtime: Optional[ComplyChatEmbeddingWorker] = None


def start_embedding_worker() -> None:
    global _runtime
    if _runtime is None:
        _runtime = ComplyChatEmbeddingWorker()
    _runtime.start()


def stop_embedding_worker() -> None:
    global _runtime
    if _runtime is None:
        return
    _runtime.stop()


def run_worker_forever(*, interval_seconds: Optional[int] = None, force_first_sync: Optional[bool] = None) -> None:
    worker = ComplyChatEmbeddingWorker()
    if interval_seconds is not None:
        worker.interval_seconds = max(30, int(interval_seconds))
    if force_first_sync is not None:
        worker.force_first_sync = bool(force_first_sync)
    worker.start()
    try:
        while worker.is_running():
            time.sleep(0.5)
    except KeyboardInterrupt:
        logger.info("Stopping ComplyChat embedding worker (keyboard interrupt).")
    finally:
        worker.stop()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ComplyChat Qdrant embedding sync worker")
    parser.add_argument("--once", action="store_true", help="Run one sync cycle and exit")
    parser.add_argument("--force", action="store_true", help="Force re-indexing of all documents")
    parser.add_argument("--interval", type=int, default=None, help="Loop interval in seconds (min 30)")
    parser.add_argument(
        "--tenant-id",
        action="append",
        type=int,
        dest="tenant_ids",
        help="Optional tenant id(s) to scope indexing (repeatable)",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    if args.once:
        summary = sync_embeddings_once(force=bool(args.force), tenant_ids=args.tenant_ids)
        logger.info("One-time embedding sync summary: %s", summary)
        return
    run_worker_forever(interval_seconds=args.interval, force_first_sync=bool(args.force))


if __name__ == "__main__":
    main()
