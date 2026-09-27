"""Breach alerts: the monitoring signals that may mean a supplier was hit, worked like cases.

A breach, adverse-media or vulnerability signal is an alert. It moves new →
investigating → confirmed or not relevant → closed, and every move is audited
with the note that went with it. Moving an alert on from new acknowledges it,
so it leaves the attention queue. Marking it not relevant also remembers its
articles, so the same reports are not raised again; confirming it can raise a
finding on the supplier.

The AI can research an alert. It reads the articles the alert was built from
(fetched here, from public addresses only) together with what the supplier does
for us, and says what happened, whether it concerns this supplier or a namesake,
what data was involved, whether ours is likely to be, and what to do next. It
works only from those articles and says so when they are silent. Its reading
is kept on the alert and changes nothing by itself.
"""
from __future__ import annotations

import ipaddress
import re
import socket
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional
from urllib.parse import urljoin, urlparse

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAAuditLog, TPRAMonitoringSignal, Vendor, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from . import monitoring, rbac, service

router = APIRouter(tags=["Vendor breach alerts"])

ALERT_TYPES = ("breach", "adverse_media", "vulnerability")
STATUSES = ("new", "investigating", "confirmed", "not_relevant", "closed")
MOVES = {
    "new": {"investigating", "confirmed", "not_relevant"},
    "investigating": {"new", "confirmed", "not_relevant"},
    "confirmed": {"investigating", "closed"},
    "not_relevant": {"investigating", "closed"},
    "closed": {"investigating"},
}
NOTE_NEEDED = {"confirmed", "not_relevant", "closed"}     # a decision says why
MAX_SOURCES = 3
MAX_PAGE_BYTES = 600_000
PAGE_CHARS = 6000
_INACTIVE = ("retired", "offboarded", "inactive", "terminated", "requested", "rejected")


def status_of(sig: TPRAMonitoringSignal) -> str:
    """An alert acknowledged elsewhere (the Signals feed, or before triage existed)
    without being worked reads as closed."""
    if sig.triage_status and sig.triage_status != "new":
        return sig.triage_status
    return "closed" if sig.acknowledged else "new"


# ── reading the articles, safely ─────────────────────────────────────────────

def _public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    return bool(infos) and all(ipaddress.ip_address(info[4][0].split("%")[0]).is_global for info in infos)


def _text(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "form"]):
        tag.decompose()
    return " ".join(soup.get_text(" ").split())[:PAGE_CHARS]


def read_page(url: str, get: Callable = requests.get, public: Callable = _public) -> Optional[str]:
    """The readable text of a public web page, or None. Each hop of a redirect is
    checked again, so a link cannot bounce the request onto an internal address.
    ponytail: the address is checked, then resolved again by requests; pin the
    resolved address if a rebinding host ever matters here."""
    for _ in range(4):
        parts = urlparse(url)
        if parts.scheme not in ("http", "https") or not parts.hostname or not public(parts.hostname):
            return None
        resp = get(url, timeout=8, stream=True, allow_redirects=False,
                   headers={"User-Agent": "Mozilla/5.0 (compatible; third-party-risk-review)"})
        try:
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
                url = urljoin(url, resp.headers["Location"])
                continue
            kind = (resp.headers.get("Content-Type") or "text/html").lower()
            if resp.status_code != 200 or not ("html" in kind or "text/plain" in kind):
                return None
            body = b""
            for chunk in resp.iter_content(16384):
                body += chunk
                if len(body) >= MAX_PAGE_BYTES:
                    break
            text = body.decode(resp.encoding or "utf-8", errors="ignore")
            return _text(text) if "html" in kind else " ".join(text.split())[:PAGE_CHARS]
        finally:
            resp.close()
    return None


# ── the AI's reading ─────────────────────────────────────────────────────────

_ASK = """You help a third-party risk team triage an alert about one of its suppliers.
Use only the articles below. If they do not say something, say it is not stated; never guess.
Answer with one JSON object with these keys:
- "summary": two or three sentences on what the articles report
- "about_this_supplier": "yes", "no" (a different organisation with a similar name) or "unclear"
- "what_happened": one sentence, or "not stated"
- "when": the date it happened as YYYY-MM-DD, or null
- "data_involved": a list of the kinds of data exposed, empty if none are stated
- "affects_us": "likely", "possible", "unlikely" or "unknown", judged against what the supplier does for us
- "why": one or two sentences explaining affects_us
- "suggested_status": "confirmed", "not_relevant" or "investigating"
- "actions": up to five short next steps for the team
- "questions_for_supplier": up to five questions to put to the supplier
"""
_CHOICES = {"about_this_supplier": ("yes", "no", "unclear"), "affects_us": ("likely", "possible", "unlikely", "unknown"),
            "suggested_status": ("confirmed", "not_relevant", "investigating")}


def _context(v: Vendor) -> str:
    parts = [f"Supplier: {v.name}"]
    if v.description:
        parts.append(f"What it does for us: {' '.join(str(v.description).split())[:500]}")
    if v.services_provided:
        parts.append(f"Services: {', '.join(map(str, v.services_provided))[:300]}")
    parts.append(f"Access to our data: {v.data_access_level or 'not recorded'}")
    if v.data_types_accessed:
        parts.append(f"Our data it holds: {', '.join(map(str, v.data_types_accessed))[:300]}")
    if v.tier:
        parts.append(f"Risk tier: {v.tier}")
    return "\n".join(parts)


def clean_research(raw: dict) -> dict:
    text = lambda value, n: " ".join(str(value or "").split())[:n]
    out = {"summary": text(raw.get("summary"), 800), "what_happened": text(raw.get("what_happened"), 400),
           "why": text(raw.get("why"), 600)}
    for key, allowed in _CHOICES.items():
        value = str(raw.get(key) or "").strip().lower()
        out[key] = value if value in allowed else ("unclear" if key == "about_this_supplier" else
                                                   "unknown" if key == "affects_us" else "investigating")
    when = str(raw.get("when") or "")[:10]
    out["when"] = when if re.fullmatch(r"\d{4}-\d{2}-\d{2}", when) else None
    for key, n in (("data_involved", 8), ("actions", 5), ("questions_for_supplier", 5)):
        items = raw.get(key) if isinstance(raw.get(key), list) else []
        out[key] = [text(i, 200) for i in items if text(i, 200)][:n]
    return out


def research(sig: TPRAMonitoringSignal, vendor: Vendor, read: Callable = read_page,
             complete: Optional[Callable] = None) -> dict:
    from ....services.assessment_evidence_ai import _parse, openai_complete

    articles, read_from = [], []
    for s in (sig.sources or [])[:MAX_SOURCES]:
        url = s.get("url")
        body = None
        if url:
            try:
                body = read(url)
            except Exception:  # noqa: BLE001 — an article that will not load is left out, not fatal
                body = None
        if body:
            read_from.append(url)
        articles.append(f"[{len(articles) + 1}] {s.get('title') or url or 'Untitled'} "
                        f"({s.get('domain') or urlparse(url or '').hostname or 'unknown source'}"
                        f"{', ' + str(s.get('seendate') or s.get('date') or '')[:10] if (s.get('seendate') or s.get('date')) else ''})\n"
                        f"{body or 'The article could not be read; only its headline is available.'}")
    if not articles:
        articles.append("[1] No article is attached; only the alert's own text is available.")
    reply = (complete or openai_complete)([
        {"role": "system", "content": _ASK},
        {"role": "user", "content": f"{_context(vendor)}\n\nAlert: {sig.title or ''}\n{(sig.detail or '')[:1500]}\n\n"
                                    "Articles:\n" + "\n\n".join(articles)},
    ])
    return {**clean_research(_parse(reply)), "sources_read": read_from}


# ── REST ─────────────────────────────────────────────────────────────────────

def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _names(db: Session, ids) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.display_name or u.username or u.email for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))}


def _alert(db: Session, alert_id: int, tids: List[int]):
    row = (db.query(TPRAMonitoringSignal, Vendor).join(Vendor, Vendor.id == TPRAMonitoringSignal.vendor_id)
           .filter(TPRAMonitoringSignal.id == alert_id, TPRAMonitoringSignal.tenant_id.in_(tids),
                   TPRAMonitoringSignal.deleted_at.is_(None), TPRAMonitoringSignal.signal_type.in_(ALERT_TYPES)).first())
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    return row


def _row(sig: TPRAMonitoringSignal, v: Vendor, names: Dict[int, str]) -> dict:
    return {"id": sig.id, "vendor": {"id": v.id, "name": v.name, "tier": v.tier}, "type": sig.signal_type,
            "severity": sig.severity, "title": sig.title, "source": sig.source, "occurred_at": sig.occurred_at,
            "status": status_of(sig), "owner": {"id": sig.triage_owner, "name": names.get(sig.triage_owner)}
            if sig.triage_owner else None, "verified": sig.verified is not False,
            "sources": len(sig.sources or []), "researched": bool(sig.research), "finding_id": sig.finding_id}


@router.get("/alerts")
def board(status_: Optional[str] = Query(None, alias="status"), type_: Optional[str] = Query(None, alias="type"),
          days: int = Query(365, ge=7, le=1825), db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tids(user, db)[0]
    since = datetime.utcnow() - timedelta(days=days)
    rows = [(s, v) for s, v in (db.query(TPRAMonitoringSignal, Vendor).join(Vendor, Vendor.id == TPRAMonitoringSignal.vendor_id)
                                .filter(TPRAMonitoringSignal.tenant_id == tid, TPRAMonitoringSignal.deleted_at.is_(None),
                                        TPRAMonitoringSignal.signal_type.in_(ALERT_TYPES), Vendor.deleted_at.is_(None))
                                .order_by(TPRAMonitoringSignal.occurred_at.desc()).limit(2000))
            if (s.occurred_at or since) >= since or status_of(s) in ("new", "investigating")]
    counts = {k: 0 for k in STATUSES}
    for s, _ in rows:
        counts[status_of(s)] += 1
    kept = [(s, v) for s, v in rows if (not status_ or status_of(s) == status_) and (not type_ or s.signal_type == type_)]
    names = _names(db, [s.triage_owner for s, _ in kept])
    return {"items": [_row(s, v, names) for s, v in kept[:500]], "counts": counts, "types": list(ALERT_TYPES)}


@router.get("/alerts/{alert_id}")
def detail(alert_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    sig, v = _alert(db, alert_id, _tids(user, db))
    history = (db.query(TPRAAuditLog).filter(TPRAAuditLog.tenant_id == sig.tenant_id, TPRAAuditLog.entity == "signal",
                                            TPRAAuditLog.entity_id == sig.id)
               .order_by(TPRAAuditLog.created_at.desc(), TPRAAuditLog.id.desc()).limit(50).all())
    names = _names(db, [sig.triage_owner, *(h.actor_id for h in history), (sig.research or {}).get("by")])
    return {
        **_row(sig, v, names), "detail": sig.detail, "source_list": sig.sources or [], "verification": sig.verification,
        "research": {**sig.research, "by": names.get(sig.research.get("by"))} if sig.research else None,
        "triggered_assessment_id": sig.triggered_assessment_id,
        "supplier": {"description": v.description, "services": v.services_provided or [],
                     "data_access_level": v.data_access_level, "data_types": v.data_types_accessed or []},
        "moves": sorted(MOVES[status_of(sig)]),
        "history": [{"action": h.action, "from": h.from_value, "to": h.to_value, "note": h.reason, "by": names.get(h.actor_id),
                     "at": h.created_at} for h in history],
    }


class MoveIn(BaseModel):
    status: str
    note: Optional[str] = Field(None, max_length=2000)
    raise_finding: bool = False


@router.post("/alerts/{alert_id}/move")
def move(alert_id: int, body: MoveIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    sig, v = _alert(db, alert_id, _tids(user, db))
    rbac.require_write(db, user, "monitoring", "edit")
    now_status, note = status_of(sig), " ".join((body.note or "").split())
    if body.status not in MOVES[now_status]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"An alert that is {now_status.replace('_', ' ')} "
                                                         f"cannot move to {body.status.replace('_', ' ')}")
    if body.status in NOTE_NEEDED and len(note) < 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say why, in a few words")
    if body.raise_finding and body.status != "confirmed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only a confirmed alert becomes a finding")
    if body.raise_finding:
        rbac.require_write(db, user, "findings", "create")
    sig.triage_status = body.status
    if body.status == "investigating":
        sig.triage_owner = user.id
    sig.acknowledged = body.status != "new"
    if sig.acknowledged and not sig.acknowledged_at:
        sig.acknowledged_by, sig.acknowledged_at = user.id, datetime.utcnow()
    if body.status == "not_relevant":
        monitoring.remember_rejection(db, sig, user.id, note)
    sig.row_version = (sig.row_version or 1) + 1
    service.write_audit(db, sig.tenant_id, entity="signal", action="triage", vendor_id=v.id, entity_id=sig.id,
                        actor_id=user.id, from_value=now_status, to_value=body.status, reason=note or None)
    finding_id = monitoring.raise_finding(db, sig, v, user.id).id if body.raise_finding else sig.finding_id
    db.commit()
    return {**_row(sig, v, _names(db, [sig.triage_owner])), "finding_id": finding_id, "moves": sorted(MOVES[body.status])}


@router.post("/alerts/{alert_id}/research")
def research_alert(alert_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    from ....services.assessment_evidence_ai import AIUnavailable

    sig, v = _alert(db, alert_id, _tids(user, db))
    rbac.require_write(db, user, "monitoring", "edit")
    try:
        found = research(sig, v)
    except AIUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    except Exception:  # noqa: BLE001 — a failed call must not read as an empty answer
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI could not research this alert. Try again.")
    sig.research = {**found, "at": datetime.utcnow().isoformat(), "by": user.id}
    service.write_audit(db, sig.tenant_id, entity="signal", action="research", vendor_id=v.id, entity_id=sig.id,
                        actor_id=user.id, to_value=found["suggested_status"])
    db.commit()
    return {**found, "at": sig.research["at"], "by": _names(db, [user.id]).get(user.id)}
