"""A supplier's logo, from its own website, so lists and pages show it at a glance.

The icon the supplier's site declares (or its /favicon.ico) is fetched on the
supplier's own page, kept, and fetched again after a month; lists only ever show
what is kept, so opening a list never fetches anything. Every hop is checked to
be a public address, so a supplier's website cannot point the fetch inside our
network, and only small images are kept.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Callable, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAVendorLogo, Vendor, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from .alerts import _public
from .intake import host

router = APIRouter(tags=["Vendor logos"])

MAX_BYTES = 200_000
KEEP_FOR = timedelta(days=30)
TRY_AGAIN_AFTER = timedelta(days=7)          # when the site had no icon
_ICON = re.compile(r"<link[^>]+rel=[\"']?(?:shortcut )?(?:icon|apple-touch-icon)[\"']?[^>]*>", re.I)
_HREF = re.compile(r"href=[\"']?([^\"' >]+)", re.I)


def _get(url: str, get: Callable, public: Callable, accept_html: bool) -> Optional[requests.Response]:
    """A public URL, following up to three redirects, each hop checked."""
    for _ in range(4):
        parts = urlparse(url)
        if parts.scheme not in ("http", "https") or not parts.hostname or not public(parts.hostname):
            return None
        resp = get(url, timeout=8, stream=True, allow_redirects=False,
                   headers={"User-Agent": "Mozilla/5.0 (compatible; third-party-risk-review)"})
        if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
            url = urljoin(url, resp.headers["Location"])
            resp.close()
            continue
        kind = (resp.headers.get("Content-Type") or "").lower()
        if resp.status_code != 200 or not (kind.startswith("image/") or (accept_html and "html" in kind)):
            resp.close()
            return None
        return resp
    return None


def _body(resp: requests.Response) -> Optional[bytes]:
    data = b""
    try:
        for chunk in resp.iter_content(16384):
            data += chunk
            if len(data) > MAX_BYTES:
                return None
    finally:
        resp.close()
    return data or None


def fetch(website: Optional[str], get: Callable = requests.get, public: Callable = _public) -> Optional[Tuple[bytes, str]]:
    """(image, content type) for the supplier's icon, or None."""
    site = host(website)
    if not site:
        return None
    base = f"https://{site}/"
    candidates = []
    page = _get(base, get, public, accept_html=True)
    if page is not None and "html" in (page.headers.get("Content-Type") or "").lower():
        html = (_body(page) or b"").decode("utf-8", errors="ignore")
        for tag in _ICON.findall(html)[:5]:
            found = _HREF.search(tag)
            if found:
                candidates.append(urljoin(base, found.group(1)))
    elif page is not None:
        page.close()
    candidates.append(urljoin(base, "/favicon.ico"))
    for url in candidates:
        resp = _get(url, get, public, accept_html=False)
        if resp is not None:
            kind = (resp.headers.get("Content-Type") or "image/x-icon").split(";")[0].strip()
            data = _body(resp)
            if data:
                return data, kind
    return None


@router.get("/vendors/{vendor_id}/logo")
def logo(vendor_id: int, cached_only: bool = Query(False), db: Session = Depends(get_db),
         user: GRCUser = Depends(require_auth)):
    """The supplier's logo. Lists ask for `cached_only`, which never fetches."""
    tids = get_user_tenants(user, db)
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids or [-1]), Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    now = datetime.utcnow()
    row = db.query(TPRAVendorLogo).filter(TPRAVendorLogo.vendor_id == v.id).first()
    fresh = row is not None and now - row.fetched_at < (KEEP_FOR if row.image else TRY_AGAIN_AFTER) \
        and row.website == (v.website or None)
    if not fresh and not cached_only:
        try:
            found = fetch(v.website)
        except requests.RequestException:
            found = None
        if row is None:
            row = TPRAVendorLogo(tenant_id=v.tenant_id, vendor_id=v.id)
            db.add(row)
        row.image, row.content_type = (found[0], found[1]) if found else (None, None)
        row.website, row.fetched_at = v.website or None, now
        db.commit()
    if row is None or not row.image:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return Response(content=row.image, media_type=row.content_type or "image/x-icon",
                    headers={"Cache-Control": "private, max-age=86400"})
