"""Running a studio turn in the background.

A turn can take a minute or more, so the request returns at once with the assistant's (working) message and the turn runs in
a thread of the API process with its own tenant session. Its progress and result are written on the message row, so the page
polls the message and a refresh loses nothing; a turn whose worker died is closed by ``service.reap`` after fifteen minutes.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

INLINE = False          # tests run a turn on the calling thread


def run(tenant_slug: str, kind: str, session_id: int, message_id: int, user_id: int, username: str, extra: Optional[Dict[str, Any]] = None) -> None:
    from ....db import open_tenant_session
    from ....services.ai_usage import usage_scope
    from . import engine

    db = open_tenant_session(tenant_slug)
    try:
        with usage_scope(tenant_slug=tenant_slug, actor_user_id=user_id, actor_username=username, module_key="governance", feature_key=f"studio_{kind}"):
            if kind == "chat":
                engine.run_chat_turn(db, session_id, message_id)
            elif kind == "checks":
                engine.run_ai_checks(db, session_id, message_id)
            elif kind == "compare":
                engine.run_ai_compare(db, session_id, message_id, (extra or {}).get("title", ""), (extra or {}).get("markdown", ""))
    except Exception:       # noqa: BLE001 - the engine writes its own failures on the message; this is the last resort
        logger.exception("studio %s turn %s crashed", kind, message_id)
    finally:
        db.close()


def launch(tenant_slug: str, kind: str, session_id: int, message_id: int, user, extra: Optional[Dict[str, Any]] = None) -> None:
    args = (tenant_slug, kind, session_id, message_id, user.id, getattr(user, "username", None) or "user", extra)
    if INLINE:
        run(*args)
    else:
        threading.Thread(target=run, args=args, daemon=True, name=f"studio-{kind}-{message_id}").start()
