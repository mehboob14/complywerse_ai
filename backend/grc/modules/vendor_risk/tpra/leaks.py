"""Credentials published by mistake: public code that names a supplier's domain,
or our own, beside words like password or secret.

With GitHub connected under Admin → Connectors (code search) and the search
switched on in Settings → Monitoring, each supplier's domains are searched on
the outside-in cadence. A hit is an unverified breach alert: a person opens the
file, and confirms it or rules it out on the Breach alerts page; unverified, it
never emails anyone and never reopens an assessment. Our own domains, listed in
Settings, are searched once a day and listed on the Breach alerts page.

What is found is linked, never copied: the file may hold the secret itself.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, IntegrationConnection, TPRAAuditLog, TPRAOwnLeak, Vendor, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from . import rbac, service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Vendor leaked credentials"])

CATEGORY, INTEGRATION = "code_search", "github_code"
DOMAINS_PER_SUPPLIER = 3
OWN_EVERY = timedelta(hours=20)
_HOST = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def token(db: Session, tenant_id: int) -> Optional[str]:
    """The tenant's GitHub token, when code search is connected."""
    from ....services.connector_credentials import decrypt_credentials

    row = (db.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id == tenant_id, IntegrationConnection.category == CATEGORY,
        IntegrationConnection.integration_type == INTEGRATION, IntegrationConnection.is_active.is_(True)).first())
    creds = decrypt_credentials(row.encrypted_credentials) if row is not None else None
    return (creds or {}).get("api_token") or None


def switched_on(db: Session, tenant_id: int) -> bool:
    from .monitoring_policy import for_tenant

    return bool(for_tenant(db, tenant_id).get("leak_search")) and token(db, tenant_id) is not None


def drafts(vendor: Vendor, domains: List[str], hits_for: Callable[[str], List[dict]], now: datetime) -> List[dict]:
    """One unverified breach alert per file found, for up to three of the supplier's domains."""
    out = []
    for domain in domains[:DOMAINS_PER_SUPPLIER]:
        for hit in hits_for(domain):
            out.append({
                "signal_type": "breach", "severity": "high",
                "title": f"Possible leaked credential for {domain} in {hit['repository']}",
                "detail": (f"A public file on GitHub names {domain} beside a word like password or secret. Open it to "
                           "see whether a live secret is exposed, and tell the supplier if it is. The file is linked "
                           "here, not copied."),
                "external_id": f"leak:{hit['repository']}:{hit['path']}"[:200], "occurred_at": now,
                "sources": [{"url": hit["url"], "title": f"{hit['repository']}/{hit['path']}"[:300], "domain": "github.com"}],
                "verification": {"verified": False, "checks": {"source": "GitHub code search",
                                                               "match": "domain beside a credential word; unconfirmed"}},
            })
    return out


# ── our own domains ──────────────────────────────────────────────────────────

def own_sweep(db: Session, tenant_id: int, now: Optional[datetime] = None, get=None) -> Optional[dict]:
    """Search our own domains once a day, when switched on. New files are listed;
    ones already listed keep their decision."""
    from ...connectors.providers.code_search import search
    from .monitoring_policy import for_tenant

    now = now or datetime.utcnow()
    policy = for_tenant(db, tenant_id)
    domains = [d for d in policy.get("own_domains") or [] if d]
    key = token(db, tenant_id)
    if not policy.get("leak_search") or not domains or not key:
        return None
    last = (db.query(TPRAAuditLog.created_at).filter(TPRAAuditLog.tenant_id == tenant_id,
                                                      TPRAAuditLog.entity == "own_leaks", TPRAAuditLog.action == "sweep")
            .order_by(TPRAAuditLog.created_at.desc()).first())
    if last is not None and last[0] is not None and now - last[0] < OWN_EVERY:
        return None
    held = {(r.repository, r.path): r for r in db.query(TPRAOwnLeak).filter(TPRAOwnLeak.tenant_id == tenant_id)}
    new = failed = 0
    for domain in domains:
        try:
            hits = search(domain, key, **({"get": get} if get else {}))
        except Exception as exc:  # noqa: BLE001 — one domain must not stop the rest
            logger.warning("own-domain code search for %s failed: %s", domain, exc)
            failed += 1
            continue
        for hit in hits:
            row = held.get((hit["repository"], hit["path"]))
            if row is None:
                row = TPRAOwnLeak(tenant_id=tenant_id, domain=domain, repository=hit["repository"][:255],
                                  path=hit["path"][:500], url=hit["url"][:600], first_seen=now, status="new")
                db.add(row)
                held[(hit["repository"], hit["path"])] = row
                new += 1
            row.last_seen = now
    service.write_audit(db, tenant_id, entity="own_leaks", action="sweep", to_value=f"{new} new",
                        reason=f"{failed} domains could not be searched" if failed else None)
    db.commit()
    return {"new": new, "failed": failed}


# ── REST ─────────────────────────────────────────────────────────────────────

def _tid(user: GRCUser, db: Session) -> int:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids[0]


def clean_domains(values) -> List[str]:
    """Our own domains for the settings: host names only, at most twenty."""
    if not isinstance(values, list) or len(values) > 20:
        raise ValueError("List at most twenty of our own domains")
    out = []
    for value in values:
        host = re.sub(r"^[a-z]+://", "", str(value or "").strip().lower()).split("/")[0].removeprefix("www.")
        if not _HOST.match(host):
            raise ValueError(f"'{value}' is not a domain such as example.com")
        if host not in out:
            out.append(host)
    return out


@router.get("/leaks/own")
def own_leaks(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tid(user, db)
    rows = (db.query(TPRAOwnLeak).filter(TPRAOwnLeak.tenant_id == tid)
            .order_by(TPRAOwnLeak.status != "new", TPRAOwnLeak.first_seen.desc()).limit(300).all())
    ids = {r.decided_by for r in rows if r.decided_by}
    names = {u.id: u.display_name or u.username for u in db.query(GRCUser).filter(GRCUser.id.in_(ids or [-1]))}
    return {"items": [{"id": r.id, "domain": r.domain, "repository": r.repository, "path": r.path, "url": r.url,
                       "first_seen": r.first_seen, "last_seen": r.last_seen, "status": r.status, "note": r.note,
                       "decided_by": names.get(r.decided_by), "decided_at": r.decided_at} for r in rows],
            "switched_on": switched_on(db, tid)}


class DecisionIn(BaseModel):
    status: Literal["new", "confirmed", "dismissed"]
    note: Optional[str] = Field(None, max_length=1000)


@router.post("/leaks/own/{leak_id}")
def decide(leak_id: int, body: DecisionIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tid(user, db)
    rbac.require_write(db, user, "monitoring", "edit")
    row = db.query(TPRAOwnLeak).filter(TPRAOwnLeak.id == leak_id, TPRAOwnLeak.tenant_id == tid).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    note = " ".join((body.note or "").split())
    if body.status == "dismissed" and len(note) < 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Say why it is not a leak")
    before = row.status
    row.status, row.note = body.status, note or row.note
    row.decided_by, row.decided_at = (user.id, datetime.utcnow()) if body.status != "new" else (None, None)
    service.write_audit(db, tid, entity="own_leaks", action="decide", entity_id=row.id, actor_id=user.id,
                        from_value=before, to_value=body.status, reason=note or None)
    db.commit()
    return {"id": row.id, "status": row.status}
