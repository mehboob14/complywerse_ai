"""Calendar months for the Auditor Portal's front-door history (the Overview's charts).

`month_windows(now)` is the last N calendar months, oldest first, each as (key "YYYY-MM", start, end) with `end` EXCLUSIVE (the next month's first instant).
The current month's end is in the future: nothing is recorded after `now`, so "as of the end of the month" is "as of now" for it. All instants are naive UTC,
the way the platform's DateTime columns are stored.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Tuple


def month_windows(now: datetime, count: int = 12) -> List[Tuple[str, datetime, datetime]]:
    count = max(1, int(count))
    here = now.year * 12 + (now.month - 1)
    out: List[Tuple[str, datetime, datetime]] = []
    for back in range(count - 1, -1, -1):
        sy, sm = divmod(here - back, 12)
        ey, em = divmod(here - back + 1, 12)
        out.append((f"{sy:04d}-{sm + 1:02d}", datetime(sy, sm + 1, 1), datetime(ey, em + 1, 1)))
    return out
