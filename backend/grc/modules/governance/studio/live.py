"""What the screen shows while an AI turn works, beyond one line of text.

A turn used to say "Writing" for minutes. Now its message row keeps (``live``) the steps it has taken, the text the AI has written
so far, what it has produced so far (the changes it is preparing, the choices it has made) and, for a whole document, each part and
how far it has got. The page asks for it a few times a second (``GET .../progress``). It is a view and nothing else: what is kept
and acted on is the finished answer, written on the message when the turn ends, which also clears this (``StudioMessage`` forgets
``live`` as soon as its status is not "working").

Only the thread that owns the database session writes the row. The threads that write the parts of a document report to a ``Board``
(in memory), and the owning thread saves the board.
"""
from __future__ import annotations

import re
import threading
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

MAX_STEPS = 12
MAX_TAIL = 1200                         # characters of the text being written that the screen shows
MAX_TEXT = 6000
SAVE_EVERY = 0.6                        # seconds between two saves of the parts of a draft written on the saving thread
STOP_EVERY = 1.0                        # seconds between two looks at whether the person stopped the turn


def stopper(db, message_id: int) -> Callable[[], bool]:
    """Whether the person stopped the turn (its message is no longer "working": the Stop route changed it, or it was deleted), read
    from the database at most every ``STOP_EVERY`` seconds. For the thread that owns ``db`` only."""
    from ....models import StudioMessage

    state = {"at": 0.0, "stopped": False}

    def stopped() -> bool:
        if not state["stopped"] and time.monotonic() - state["at"] >= STOP_EVERY:
            state["at"] = time.monotonic()
            with db.no_autoflush:
                status = db.query(StudioMessage.status).filter(StudioMessage.id == message_id).scalar()
            state["stopped"] = status != "working"
        return state["stopped"]

    return stopped


def still_working(db, msg) -> bool:
    """Whether the turn may still finish its message. The row stays locked until the next commit, so a Stop that comes now waits for
    the result and then finds the turn finished, and one that came before is seen here."""
    db.refresh(msg, with_for_update=True)
    return msg.status == "working"


def forget(db, message_id: int) -> None:
    """After a Stop: what the turn saved of its progress after the Stop had cleared it."""
    from ....models import StudioMessage

    db.rollback()
    db.query(StudioMessage).filter(StudioMessage.id == message_id, StudioMessage.status != "working").update(
        {"live": None, "stage": None, "preview": None}, synchronize_session=False)
    db.commit()


def fail(db, message_id: int, text: str) -> None:
    """A turn that went wrong says so on its message, unless the person stopped it first."""
    from ....models import StudioMessage

    db.rollback()
    msg = db.get(StudioMessage, message_id)
    if msg is not None and msg.status == "working":
        msg.status, msg.stage, msg.error, msg.updated_at = "error", None, text, datetime.utcnow()
        db.commit()


def _same(a: Optional[Dict[str, Any]], b: Optional[Dict[str, Any]]) -> bool:
    drop = lambda d: {k: v for k, v in (d or {}).items() if k != "seq"}      # noqa: E731
    return drop(a) == drop(b)


def _save(db, msg, live: Dict[str, Any], stage: Optional[str] = None) -> None:
    before = msg.live
    stage = stage[:120] if stage is not None else None
    if _same(before, live) and (stage is None or msg.stage == stage):
        return
    live["seq"] = int((before or {}).get("seq", 0)) + 1
    if stage is not None:
        msg.stage = stage
    msg.live, msg.updated_at = live, datetime.utcnow()
    db.commit()


def stage(db, msg, label: str, *, step: bool = True, detail: Optional[str] = None, **fields: Any) -> None:
    """The line the screen shows now. A new line closes the one before it in the list of steps; ``step=False`` only rewords the
    current line (a counter). ``detail`` is a few words under the line; ``fields`` are merged into the live view as in ``update``."""
    live = dict(msg.live or {})
    steps: List[Dict[str, Any]] = [dict(s) for s in live.get("steps") or []]
    if step or not steps:
        steps = [dict(s, state="done") for s in steps] + [{"label": label, "state": "active"}]
    else:
        steps[-1]["label"] = label
    if detail is not None:
        steps[-1]["detail"] = detail
    live["steps"] = steps[-MAX_STEPS:]
    _merge(live, fields)
    _save(db, msg, live, label)


def note(db, msg, text: str) -> None:
    """A few words under the current line (what it found: "42 blocks, 2 references")."""
    live = dict(msg.live or {})
    steps = [dict(s) for s in live.get("steps") or []]
    if steps:
        steps[-1]["detail"] = text
        live["steps"] = steps
        _save(db, msg, live)


def update(db, msg, **fields: Any) -> None:
    """Merge ``fields`` into the live view (a value of None takes the field away) and save it."""
    live = dict(msg.live or {})
    _merge(live, fields)
    _save(db, msg, live)


def _merge(live: Dict[str, Any], fields: Dict[str, Any]) -> None:
    for key, value in fields.items():
        if value is None or value == [] or value == "":
            live.pop(key, None)
        else:
            live[key] = value[:MAX_TEXT] if isinstance(value, str) else value


def tail(text: str, show: Callable[[str], str] = str, size: int = MAX_TAIL) -> str:
    """The last lines of ``text`` for the screen, cut at a word (so that a placeholder is never cut in half) and shown through ``show``."""
    if len(text) > size:
        text = text[-size:]
        cut = re.search(r"\s", text)
        text = text[cut.end():] if cut else text
    return show(text)


def words(text: str) -> int:
    return len(re.findall(r"\w+", text or ""))


class Board:
    """What the parts of a draft are doing. The threads that write the parts report here (``set``, ``tail``); the thread that owns the
    database session saves it (``save``). When the parts are written on that same thread, ``touch`` saves as they report."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._owner = threading.get_ident()
        self._parts: Dict[str, Dict[str, Any]] = {}
        self._tails: Dict[str, str] = {}
        self._texts: Dict[str, str] = {}                              # each part as far as it is written: the document shown meanwhile
        self._shown: Optional[str] = None
        self._at = 0.0
        self.saver: Optional[Callable[[], None]] = None              # set by the owner when it writes parts itself

    def add(self, label: str) -> str:
        """A part that has not started; returns the key to report it by."""
        with self._lock:
            key = str(len(self._parts))
            self._parts[key] = {"id": key, "label": label, "state": "todo", "words": 0}
        return key

    def set(self, key: str, **fields: Any) -> None:
        with self._lock:
            part = self._parts.get(key)
            if part is not None:
                part.update(fields)
                for empty in [k for k, v in part.items() if v is None]:
                    del part[empty]
        self.touch()

    def tail(self, key: str, text: str) -> None:
        with self._lock:
            self._tails[key] = text
        self.touch()

    def text(self, key: str, text: str) -> None:
        with self._lock:
            self._texts[key] = text

    def written(self) -> Dict[str, Tuple[str, str]]:
        """Each part's state and its text so far."""
        with self._lock:
            return {k: (p["state"], self._texts.get(k, "")) for k, p in self._parts.items()}

    def touch(self) -> None:
        """Save now when this is the owning thread and the last save is not recent (parts written on the owner's own thread)."""
        if self.saver is not None and threading.get_ident() == self._owner and time.monotonic() - self._at >= SAVE_EVERY:
            self._at = time.monotonic()
            self.saver()

    def counts(self) -> Dict[str, int]:
        with self._lock:
            states = [p["state"] for p in self._parts.values()]
        return {"total": len(states), "done": states.count("done") + states.count("failed")}

    def view(self) -> Dict[str, Any]:
        """The parts, and the text of the one that is being written (the same one until it is done)."""
        with self._lock:
            parts = [dict(p) for p in self._parts.values()]
            tails = dict(self._tails)
        writing = [p for p in parts if p["state"] in ("writing", "rewriting")]
        shown = next((p for p in writing if p["id"] == self._shown), None) or (writing[0] if writing else None)
        self._shown = shown["id"] if shown else None
        return {"parts": parts or None, "tail": (tails.get(shown["id"]) or None) if shown else None,
                "tail_label": f"Writing {shown['label']}" if shown else None}

    def save(self, db, msg) -> None:
        update(db, msg, **self.view())
