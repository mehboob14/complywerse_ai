"""Defensive table provisioning for the framework template tables.

The two tables (grc_framework_register_entries, grc_framework_documents) are
also created by the global Base.metadata.create_all on engine init, but that is
memoized per process — so a long-running process that healed before this feature
shipped would not pick them up until a restart. This helper creates just these
two tables on first request per engine (idempotent, checkfirst) so the feature
works without depending on restart ordering.
"""
import threading
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...models import Base, FrameworkRegisterEntry, FrameworkDocument

_ensured = set()
_lock = threading.Lock()


def ensure_framework_template_tables(db: Session) -> None:
    try:
        bind = db.get_bind()
        key = str(getattr(bind, "url", bind))
    except Exception:
        key = "default"
    if key in _ensured:
        return
    with _lock:
        if key in _ensured:
            return
        try:
            Base.metadata.create_all(
                bind=db.get_bind(),
                tables=[FrameworkRegisterEntry.__table__, FrameworkDocument.__table__],
                checkfirst=True,
            )
            # Additive columns for the document review workflow — create_all does
            # NOT alter an already-provisioned table on existing tenant DBs.
            for col, ddl in (("reviewer_id", "INTEGER"), ("approver_id", "INTEGER"),
                             ("submitted_for_review_at", "TIMESTAMP"), ("submitted_by", "INTEGER")):
                try:
                    db.execute(text(f"ALTER TABLE grc_framework_documents ADD COLUMN IF NOT EXISTS {col} {ddl}"))
                    db.commit()
                except Exception:
                    db.rollback()
            _ensured.add(key)
        except Exception:
            # Never break a request on a self-heal failure; the query will
            # surface a clear error if the table is genuinely missing.
            pass
