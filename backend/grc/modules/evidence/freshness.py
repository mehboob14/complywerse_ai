"""When evidence is no longer in date, worked out when it is READ (UX revamp, Stage 4; audit G10 P-2).

Nothing in the platform marks evidence stale or expired on a schedule (``POST /lifecycle/check-staleness`` and ``/{id}/expire`` are only called by hand
or by an optional workflow action), so the stored ``is_stale`` flag stayed false for files long past their date: the Stale filter and pill were empty
and an approved file past its expiry read as in force. A file has LAPSED when it is past its validity: its flag is set, its status is ``expired``, or its
expiry date has gone by. Archived files are out of play and never lapse. Nothing is written here; what ``approved`` means is not changed (the status
column is untouched), the readers just stop trusting a flag nobody sets.
"""
from datetime import datetime
from typing import Any

from sqlalchemy import and_, or_

from ...models import Evidence


def is_lapsed(evidence: Any, now: datetime) -> bool:
    """True when this evidence is past its validity (see the module note)."""
    if evidence.status == "archived":
        return False
    return bool(evidence.is_stale) or evidence.status == "expired" or bool(evidence.expiry_date and evidence.expiry_date < now)


def lapsed_clause(now: datetime):
    """The same rule as a SQL condition, for the list filters."""
    return and_(
        or_(Evidence.status.is_(None), Evidence.status != "archived"),
        or_(Evidence.is_stale.is_(True), Evidence.status == "expired",
            and_(Evidence.expiry_date.isnot(None), Evidence.expiry_date < now)),
    )
