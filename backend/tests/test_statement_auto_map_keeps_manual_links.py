"""Re-mapping a policy statement replaces the AI's links, never a person's.

A control authored from a statement (Governance -> Statements -> Create
control) is linked with created_by_ai=False. Auto-mapping used to clear every
unlocked row before re-mapping, so re-parsing a document silently deleted those
links along with its own suggestions.
"""
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from grc.models import Base, StatementControlMapping
from grc.modules.governance import statement_auto_map


def test_remap_clears_ai_rows_but_keeps_manual_and_locked_ones(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[StatementControlMapping.__table__])
    monkeypatch.setattr(statement_auto_map, "_ai_available", lambda: False)

    with Session(engine) as db:
        def row(code, **kw):
            db.add(StatementControlMapping(
                tenant_id=3, statement_id=7, control_kind="normalized", control_code=code, **kw))

        row("AI-1", created_by_ai=True, is_locked=False)
        row("LEGACY", created_by_ai=None, is_locked=False)      # pre-flag rows were AI
        row("MANUAL", created_by_ai=False, is_locked=False, link_source="manual")
        row("LOCKED", created_by_ai=True, is_locked=True)
        db.commit()

        statement_auto_map.auto_map_statement(db, SimpleNamespace(id=7))

        left = sorted(c for (c,) in db.query(StatementControlMapping.control_code).all())
        assert left == ["LOCKED", "MANUAL"]
