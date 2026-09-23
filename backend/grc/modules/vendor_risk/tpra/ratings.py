"""Security ratings from outside the organisation, kept as history.

A ratings provider (SecurityScorecard, BitSight, UpGuard and the like) is a paid
feed, and none is wired in (decision 2: add one when a client asks and pays).
Until then a tenant imports the export its provider gives it; a connector for a
provider would write the same rows. Every score is kept, so the vendor page can
show a trend, and a fall of DROP_POINTS or more becomes a monitoring signal —
and so reaches the attention queue — without anyone typing it.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from ....models import TPRAExternalRating, TPRAMonitoringSignal, Vendor
from . import monitoring

DROP_POINTS = 10          # a fall this size or more is a signal
SEVERE_DROP_POINTS = 20   # and this size or more a high-severity one
MAX_ROWS = 5000


def record(db: Session, vendor: Vendor, provider: str, score: float, captured_at: datetime,
           grade: Optional[str] = None, actor_id: Optional[int] = None
           ) -> Tuple[Optional[TPRAExternalRating], Optional[TPRAMonitoringSignal]]:
    """Keep one score. Returns (the rating, or None when that day is already held;
    the signal a drop raised, if any)."""
    day = captured_at.replace(hour=0, minute=0, second=0, microsecond=0)
    held = db.query(TPRAExternalRating.id).filter(
        TPRAExternalRating.vendor_id == vendor.id, TPRAExternalRating.provider == provider,
        TPRAExternalRating.captured_at == day).first()
    if held:
        return None, None
    previous = (db.query(TPRAExternalRating).filter(
        TPRAExternalRating.vendor_id == vendor.id, TPRAExternalRating.provider == provider,
        TPRAExternalRating.captured_at < day).order_by(TPRAExternalRating.captured_at.desc()).first())
    rating = TPRAExternalRating(tenant_id=vendor.tenant_id, vendor_id=vendor.id, provider=provider,
                                score=float(score), grade=(grade or None) and str(grade)[:8], captured_at=day)
    db.add(rating)
    db.flush()
    if previous is None or previous.score - rating.score < DROP_POINTS:
        return rating, None
    drop = previous.score - rating.score
    signal, _, _ = monitoring.record_signal(
        db, vendor, signal_type="security_rating", severity="high" if drop >= SEVERE_DROP_POINTS else "medium",
        title=f"{provider} rating for {vendor.name} fell from {previous.score:g} to {rating.score:g}",
        detail=(f"The external security rating dropped {drop:g} points between "
                f"{previous.captured_at:%d %b %Y} and {day:%d %b %Y}."),
        source=provider, occurred_at=day, external_id=f"rating:{provider}:{day:%Y%m%d}",
        sources=[{"title": f"{provider} rating {day:%d %b %Y}", "score": rating.score, "previous": previous.score}],
        actor_id=actor_id)
    return rating, signal


def _date(value: str) -> Optional[datetime]:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%d-%m-%Y"):
        try:
            return datetime.strptime(value.strip()[:19], fmt)
        except ValueError:
            continue
    return None


def parse(content: bytes, vendors: List[Vendor], default_provider: str) -> Tuple[List[dict], List[str]]:
    """Rows from a provider's CSV export: vendor (name or id), score (0-100), date,
    and optionally provider and grade. Problems are reported by line, not guessed."""
    text = content.decode("utf-8-sig", "replace")
    reader = csv.DictReader(io.StringIO(text))
    fields = {(f or "").strip().lower(): f for f in reader.fieldnames or []}
    missing = [c for c in ("vendor", "score", "date") if c not in fields]
    if missing:
        raise ValueError(f"The file needs columns named vendor, score and date (missing: {', '.join(missing)})")
    by_name = {(v.name or "").strip().lower(): v for v in vendors}
    by_id = {str(v.id): v for v in vendors}
    rows, problems = [], []
    for line_no, raw in enumerate(reader, start=2):
        if line_no > MAX_ROWS + 1:
            problems.append(f"Only the first {MAX_ROWS} rows were read")
            break
        get = lambda col: (raw.get(fields[col]) or "").strip() if col in fields else ""  # noqa: E731
        who = get("vendor")
        vendor = by_id.get(who) or by_name.get(who.lower())
        if vendor is None:
            problems.append(f"Line {line_no}: no vendor called '{who[:60]}'")
            continue
        try:
            score = float(get("score"))
        except ValueError:
            problems.append(f"Line {line_no}: '{get('score')[:20]}' is not a score")
            continue
        if not 0 <= score <= 100:
            problems.append(f"Line {line_no}: a score must be from 0 to 100")
            continue
        when = _date(get("date"))
        if when is None:
            problems.append(f"Line {line_no}: '{get('date')[:20]}' is not a date")
            continue
        rows.append({"vendor": vendor, "score": score, "captured_at": when,
                     "provider": (get("provider") or default_provider)[:60], "grade": get("grade") or None})
    return rows, problems


def import_rows(db: Session, rows: List[dict], actor_id: Optional[int]) -> Dict[str, int]:
    """Oldest first, so each drop is measured against the score before it."""
    counts = {"imported": 0, "already_held": 0, "drops": 0}
    for row in sorted(rows, key=lambda r: r["captured_at"]):
        rating, signal = record(db, row["vendor"], row["provider"], row["score"], row["captured_at"],
                                row["grade"], actor_id)
        counts["imported" if rating else "already_held"] += 1
        counts["drops"] += int(signal is not None)
    return counts


def history(db: Session, vendor_id: int) -> List[dict]:
    return [{"provider": r.provider, "score": r.score, "grade": r.grade, "captured_at": r.captured_at.isoformat()}
            for r in db.query(TPRAExternalRating).filter(TPRAExternalRating.vendor_id == vendor_id)
            .order_by(TPRAExternalRating.captured_at)]
