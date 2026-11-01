"""License reconciliation engine — entitlements (what we own) vs installed
software (what the scans found), reconciled live into an Effective License
Position (ELP) per product.

Read path  : every GET calls refresh_if_stale() first (mirrors risk_posture's
             refresh-on-read): expire lapsed lines, then re-derive the auto
             assignments at most once per REBUILD_TTL_SECONDS, write-on-change.
Write path : entitlement create/update/delete/import force a rebuild.
Nothing here touches the scan pipeline or ITAsset — consumption is read from
ITAsset.detected_software_json exactly as the scans stored it.

Honesty rules (the numbers end up in an audit/RFP answer):
  * entitled counts only lines that are active, started and not expired;
  * a metric the install inventory cannot measure (per_cal, usage,
    per_user_concurrent) is reported "not_measured" — never "shelfware";
  * a count that had to be guessed (cores/sockets not collected) is annotated on
    the assignment, and an unknown cost stays null instead of becoming 0;
  * reclaimable seats are a PROXY (stale/decommissioned host) — ComplyVerse has no
    software metering.
"""
from __future__ import annotations

import csv
import hashlib
import io
import logging
import math
import re
import threading
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterator, List, Optional, Sequence, Set, Tuple

from sqlalchemy import case, func, text
from sqlalchemy.orm import Session

from grc.models import ITAsset

from . import matching as M
from .models import LicenseAssignment, LicenseEntitlement

logger = logging.getLogger(__name__)

# ── vocabulary ──────────────────────────────────────────────────────────────

LICENSE_TYPES = ("perpetual", "subscription", "oem", "volume", "saas", "open_source", "trial")
LICENSE_METRICS = (
    "per_device", "per_user_named", "per_user_concurrent", "per_core", "per_socket",
    "per_processor", "per_cal", "per_installation", "usage",
)
ENTITLEMENT_STATUSES = ("active", "expired", "retired")

# Metrics an install inventory can actually count. The rest (CALs, concurrent
# seats, metered usage) need usage/connection data ComplyVerse does not have.
MEASURED_METRICS = frozenset({
    "per_device", "per_installation", "per_core", "per_socket", "per_processor", "per_user_named",
})
CPU_METRICS = frozenset({"per_core", "per_socket", "per_processor"})

EXPIRING_DAYS = 90            # a line expiring inside this window is "expiring_soon"
STALE_DAYS = 90               # host unseen this long => its seat is a reclaim candidate (proxy)
RECLAIM_BUFFER_PCT = 0.10     # headroom kept before surplus seats are called shelfware
REBUILD_TTL_SECONDS = 20      # refresh-on-read debounce (one rebuild per page load, not three)
MAX_CONSUMING_ASSETS = 500    # drill-down cap per product (the true total is returned too)
MAX_UNLICENSED_ASSETS = 50    # sample hosts per unlicensed product (install_count is the true total)
RETIRED_HOST_STATES = frozenset({"decommissioned", "retired"})
_CHUNK = 1000

# Row-level status vocabulary (positions / entitlement lines):
#   compliant | over_deployed | expiring_soon | over_licensed   — measured products
#   not_detected                                                — no install of it on record
#   not_measured                                                — metric ComplyVerse cannot count
#   expired | pending | retired                                 — lines with no live position
_STATUS_RANK = {
    "over_deployed": 0, "expiring_soon": 1, "over_licensed": 2, "compliant": 3,
    "not_detected": 4, "not_measured": 5, "expired": 6, "pending": 7, "retired": 8,
}

_TYPE_SYNONYMS = {
    "vl": "volume", "volume_license": "volume", "volume_licence": "volume", "mak": "volume", "kms": "volume",
    "oss": "open_source", "opensource": "open_source", "free": "open_source", "freeware": "open_source",
    "sub": "subscription", "subscribed": "subscription", "cloud": "saas", "permanent": "perpetual",
}
_METRIC_SYNONYMS = {
    "device": "per_device", "per_machine": "per_device", "machine": "per_device", "workstation": "per_device",
    "user": "per_user_named", "per_user": "per_user_named", "named_user": "per_user_named",
    "per_named_user": "per_user_named", "seat": "per_user_named", "per_seat": "per_user_named",
    "concurrent": "per_user_concurrent", "floating": "per_user_concurrent",
    "per_concurrent_user": "per_user_concurrent", "concurrent_user": "per_user_concurrent",
    "core": "per_core", "cores": "per_core", "per_cores": "per_core",
    "socket": "per_socket", "sockets": "per_socket",
    "processor": "per_processor", "cpu": "per_processor", "per_cpu": "per_processor",
    "cal": "per_cal", "cals": "per_cal",
    "install": "per_installation", "installation": "per_installation", "per_install": "per_installation",
    "metered": "usage", "consumption": "usage",
}


def _now() -> datetime:
    return datetime.utcnow()  # naive UTC, like every datetime column in this app


def _iso(dt: Any) -> Optional[str]:
    return dt.isoformat() if isinstance(dt, datetime) else None


def _round(v: Optional[float], n: int = 2) -> Optional[float]:
    return None if v is None else round(float(v), n)


def _expiry_end(dt: datetime) -> datetime:
    """A date-only expiry (midnight) is valid THROUGH that day."""
    if dt.hour == dt.minute == dt.second == dt.microsecond == 0:
        return dt + timedelta(days=1)
    return dt


def _as_int(v: Any) -> Optional[int]:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip()
    try:
        return int(float(s))
    except ValueError:
        return None


# ── table bootstrap ─────────────────────────────────────────────────────────

_ENSURED: Set[str] = set()


def _bind_key(db: Session) -> str:
    """Identity of the tenant database behind this session (password never part of it)."""
    bind = db.get_bind()
    eng = getattr(bind, "engine", bind)
    url = getattr(eng, "url", None)
    return url.render_as_string(hide_password=True) if url is not None else str(id(eng))


def ensure_tables(db: Session) -> None:
    """create_all makes these at engine init; this is the belt-and-braces for a
    tenant DB that was opened before the module existed (same as sbp_inventory)."""
    key = _bind_key(db)
    if key in _ENSURED:
        return
    bind = db.get_bind()
    try:
        LicenseEntitlement.__table__.create(bind=bind, checkfirst=True)
        LicenseAssignment.__table__.create(bind=bind, checkfirst=True)
    except Exception:
        # two workers racing the same CREATE: fine as long as both tables exist now
        from sqlalchemy import inspect as sa_inspect
        insp = sa_inspect(getattr(bind, "engine", bind))
        if not (insp.has_table(LicenseEntitlement.__tablename__) and insp.has_table(LicenseAssignment.__tablename__)):
            raise
    _ENSURED.add(key)


# ── entitlement validation ──────────────────────────────────────────────────

_TEXT_LIMITS = {
    "publisher": 200, "product": 300, "edition": 120, "po_reference": 120,
    "contract_reference": 120, "reseller": 200, "support_level": 80, "software_key": 80,
}
_DATE_FIELDS = ("purchase_date", "start_date", "expiry_date", "maintenance_expiry")
_DATE_FORMATS = (
    "%d-%b-%Y", "%d %b %Y", "%b %d, %Y", "%B %d, %Y", "%d %B %Y", "%d-%B-%Y",
    "%Y/%m/%d", "%Y.%m.%d",
)


class EncryptionUnavailable(RuntimeError):
    """grc.crypto could not encrypt (SESSION_SECRET missing) — a product key is
    never stored in plaintext as a fallback."""


def parse_date(value: Any) -> Optional[datetime]:
    """ISO date/datetime (or a few unambiguous text forms) -> naive UTC datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime(value.year, value.month, value.day)
    else:
        s = str(value).strip()
        if not s or s.lower() in {"none", "null", "n/a", "na", "-", "perpetual", "never", "unlimited"}:
            return None
        dt = None
        try:
            dt = datetime.fromisoformat(s[:-1] + "+00:00" if s.endswith(("Z", "z")) else s)
        except ValueError:
            for fmt in _DATE_FORMATS:
                try:
                    dt = datetime.strptime(s, fmt)
                    break
                except ValueError:
                    continue
        if dt is None:
            raise ValueError(f"Unrecognised date '{s}' - use YYYY-MM-DD.")
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _enum(value: Any, allowed: Sequence[str], field: str, default: str,
          synonyms: Dict[str, str]) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", M.clean(value).lower()).strip("_")
    if not s:
        return default
    s = synonyms.get(s, s)
    if s not in allowed:
        raise ValueError(f"{field} must be one of: {', '.join(allowed)}.")
    return s


def _quantity(value: Any) -> int:
    if value is None or M.clean(value) == "":
        return 0
    if isinstance(value, bool):
        raise ValueError("total_quantity must be a whole number.")
    try:
        n = float(str(value).replace(",", "").replace(" ", "")) if not isinstance(value, (int, float)) else float(value)
    except ValueError:
        raise ValueError("total_quantity must be a whole number.")
    if n != n or n in (float("inf"), float("-inf")) or n != int(n):
        raise ValueError("total_quantity must be a whole number.")
    n = int(n)
    if n < 0 or n > 2_000_000_000:
        raise ValueError("total_quantity must be between 0 and 2,000,000,000.")
    return n


def _money(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        n = float(value)
    else:
        s = M.clean(value)
        if not s:
            return None
        for ch in "$€£¥, ":
            s = s.replace(ch, "")
        try:
            n = float(s)
        except ValueError:
            raise ValueError("unit_cost must be a number.")
    if n < 0 or n != n or n in (float("inf"), float("-inf")):
        raise ValueError("unit_cost must be a non-negative number.")
    return round(n, 4)


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    s = M.clean(value).lower()
    if s in {"true", "1", "yes", "y", "t", "on"}:
        return True
    if s in {"false", "0", "no", "n", "f", "off"}:
        return False
    return default


def clean_entitlement(data: Dict[str, Any], partial: bool = False) -> Dict[str, Any]:
    """Validate + coerce an entitlement payload. `partial` (PUT) only touches the
    keys that are present; otherwise (POST / import) required fields are enforced
    and defaults applied. Unknown keys — including the COMPUTED consumed /
    position / status the register echoes back — are ignored. A write-only
    `_product_key` carries the plaintext key for the caller to encrypt."""
    out: Dict[str, Any] = {}
    has = data.__contains__

    for k in ("publisher", "product"):
        if has(k) or not partial:
            v = M.clean(data.get(k))
            if not v:
                raise ValueError(f"{k} is required.")
            out[k] = v[:_TEXT_LIMITS[k]]
    for k in ("edition", "po_reference", "contract_reference", "reseller", "support_level", "software_key"):
        if has(k):
            v = M.clean(data.get(k))
            out[k] = v[:_TEXT_LIMITS[k]] or None
    if has("notes"):
        out["notes"] = M.clean(data.get("notes"))[:4000] or None

    if has("license_type") or not partial:
        out["license_type"] = _enum(data.get("license_type"), LICENSE_TYPES, "license_type",
                                    "perpetual", _TYPE_SYNONYMS)
    if has("license_metric") or not partial:
        out["license_metric"] = _enum(data.get("license_metric"), LICENSE_METRICS, "license_metric",
                                      "per_device", _METRIC_SYNONYMS)
    if has("total_quantity") or not partial:
        if M.clean(data.get("total_quantity")) == "":
            raise ValueError("total_quantity is required (use 0 if none are owned).")
        out["total_quantity"] = _quantity(data.get("total_quantity"))
    if has("unit_cost"):
        out["unit_cost"] = _money(data.get("unit_cost"))
    if has("currency") or not partial:
        cur = M.clean(data.get("currency")).upper() or "USD"
        if not (2 <= len(cur) <= 8 and cur.isalpha()):
            raise ValueError("currency must be a currency code such as USD.")
        out["currency"] = cur
    for k in _DATE_FIELDS:
        if has(k):
            out[k] = parse_date(data.get(k))
    if has("maintenance_included"):
        out["maintenance_included"] = _bool(data.get("maintenance_included"), False)
    if has("downgrade_rights"):
        out["downgrade_rights"] = _bool(data.get("downgrade_rights"), True)
    if has("status"):
        s = M.clean(data.get("status")).lower()
        if s in ENTITLEMENT_STATUSES:       # a computed status echoed back by the UI is ignored
            out["status"] = s
    if has("product_key"):
        out["_product_key"] = M.clean(data.get("product_key"))
    return out


def _check_dates(start: Optional[datetime], expiry: Optional[datetime]) -> None:
    if start and expiry and expiry < start:
        raise ValueError("expiry_date is before start_date.")


def _encrypt_key(plain: str) -> Optional[str]:
    if not plain:
        return None
    from grc.crypto import encrypt_secret
    try:
        return encrypt_secret(plain)
    except RuntimeError as exc:
        raise EncryptionUnavailable(
            "Product keys cannot be stored: server-side encryption is not configured."
        ) from exc


# ── entitlement CRUD ────────────────────────────────────────────────────────

def _line_or_none(db: Session, tenant_id: int, ent_id: int) -> Optional[LicenseEntitlement]:
    return (db.query(LicenseEntitlement)
            .filter(LicenseEntitlement.id == ent_id, LicenseEntitlement.tenant_id == tenant_id)
            .first())


def create_entitlement(db: Session, tenant_id: int, data: Dict[str, Any],
                       user: Optional[str] = None, rebuild: bool = True) -> LicenseEntitlement:
    ensure_tables(db)
    f = clean_entitlement(data, partial=False)
    _check_dates(f.get("start_date"), f.get("expiry_date"))
    plain = f.pop("_product_key", "")
    row = LicenseEntitlement(tenant_id=tenant_id, created_by=(user or None), **f)
    row.product_key = _encrypt_key(plain)
    row.status = f.get("status", "active")
    db.add(row)
    db.commit()
    db.refresh(row)
    if rebuild:
        _rebuild_quietly(db, tenant_id)
    return row


def update_entitlement(db: Session, tenant_id: int, ent_id: int, data: Dict[str, Any]) -> Optional[LicenseEntitlement]:
    ensure_tables(db)
    row = _line_or_none(db, tenant_id, ent_id)
    if row is None:
        return None
    f = clean_entitlement(data, partial=True)
    plain = f.pop("_product_key", None)
    old_expiry = row.expiry_date
    _check_dates(f["start_date"] if "start_date" in f else row.start_date,
                 f["expiry_date"] if "expiry_date" in f else row.expiry_date)
    for k, v in f.items():
        setattr(row, k, v)
    if plain is not None:                       # "" clears the key, text replaces it
        row.product_key = _encrypt_key(plain)
    # A lapsed line whose expiry the operator MOVES into the future (or clears)
    # comes back to life — unless the same save sets a status explicitly. Merely
    # re-saving other fields never revives a line someone marked expired.
    if ("expiry_date" in f and f["expiry_date"] != old_expiry and "status" not in f
            and row.status == "expired"
            and (row.expiry_date is None or _now() < _expiry_end(row.expiry_date))):
        row.status = "active"
    db.commit()
    db.refresh(row)
    _rebuild_quietly(db, tenant_id)
    return row


def delete_entitlement(db: Session, tenant_id: int, ent_id: int) -> bool:
    ensure_tables(db)
    row = _line_or_none(db, tenant_id, ent_id)
    if row is None:
        return False
    # explicit (the FK also cascades): its seats go with it, and the installs they
    # covered are re-evaluated by the rebuild below.
    db.query(LicenseAssignment).filter(LicenseAssignment.entitlement_id == ent_id).delete(synchronize_session=False)
    db.delete(row)
    db.commit()
    _rebuild_quietly(db, tenant_id)
    return True


def sweep_expired(db: Session, tenant_id: int, now: Optional[datetime] = None) -> int:
    """Flip active lines whose expiry has passed to status='expired' so stored
    state (and the `licenses` report dataset) agrees with the effective state.
    Returns the number flipped. Never raises."""
    try:
        ensure_tables(db)
        now = now or _now()
        # date-only expiries are valid through the day, so only lines a full day
        # past are certain; the exact edge is handled by the effective state.
        n = (db.query(LicenseEntitlement)
             .filter(LicenseEntitlement.tenant_id == tenant_id,
                     LicenseEntitlement.status == "active",
                     LicenseEntitlement.expiry_date.isnot(None),
                     LicenseEntitlement.expiry_date < now - timedelta(days=1))
             .update({LicenseEntitlement.status: "expired", LicenseEntitlement.updated_at: now},
                     synchronize_session=False))
        if n:
            db.commit()
        return int(n or 0)
    except Exception:  # noqa: BLE001
        logger.warning("license expiry sweep failed", exc_info=True)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return 0


# ── groups (a product pool = publisher + product + edition + metric) ───────

def _line_state(line: LicenseEntitlement, now: datetime) -> str:
    """Effective state of one line: retired | expired | pending | active."""
    if line.status == "retired":
        return "retired"
    if line.status == "expired":
        return "expired"
    if line.expiry_date and now >= _expiry_end(line.expiry_date):
        return "expired"
    if line.start_date and line.start_date > now:
        return "pending"
    return "active"


class _Group:
    """All lines of one product + metric. Their quantities pool; consumption is
    measured against the pool."""

    def __init__(self, idx: int, key: tuple, line: LicenseEntitlement):
        self.idx = idx
        self.key = key
        self.publisher = line.publisher
        self.product = line.product
        self.edition = line.edition
        self.metric = line.license_metric
        self.measured = self.metric in MEASURED_METRICS
        self.cpu_metric = self.metric in CPU_METRICS
        self.lines: List[LicenseEntitlement] = []
        self.valid: List[LicenseEntitlement] = []
        self.states: Dict[int, str] = {}
        self.line_ids: Set[int] = set()
        # filled by finish()
        self.desc: Optional[M.Descriptor] = None
        self.entitled = 0
        self.unlimited = False
        self.unit_cost: Optional[float] = None
        self.currency = "USD"
        self.rep_id: Optional[int] = None
        # rebuild scratch
        self.running = 0
        self.users: Set[str] = set()
        # compute (filled from the assignments)
        self.consumed = 0
        self.stale_seats = 0
        self.assignments = 0
        self.assets: Dict[int, int] = defaultdict(int)

    def finish(self, now: datetime) -> None:
        self.valid = [l for l in self.lines if self.states[l.id] == "active"]
        self.line_ids = {l.id for l in self.lines}
        self.entitled = sum(int(l.total_quantity or 0) for l in self.valid)
        # Open-source licences are not quantity-bound: they are never "over-deployed".
        self.unlimited = bool(self.valid) and all(l.license_type == "open_source" for l in self.valid)
        priced = [l for l in self.valid if l.unit_cost is not None and (l.total_quantity or 0) > 0]
        qty = sum(l.total_quantity for l in priced)
        if priced and qty > 0:
            self.unit_cost = sum(l.total_quantity * l.unit_cost for l in priced) / qty
        cur = Counter((l.currency or "USD") for l in (priced or self.valid or self.lines))
        self.currency = cur.most_common(1)[0][0] if cur else "USD"
        self.rep_id = min((l.id for l in self.valid), default=None)
        self.desc = M.Descriptor(self.publisher, self.product, self.edition,
                                 [l.software_key for l in self.lines if l.software_key])

    # -- derived (after the assignments are attached) --
    @property
    def effective_entitled(self) -> int:
        return max(self.entitled, self.consumed) if self.unlimited else self.entitled

    @property
    def position(self) -> int:
        return self.effective_entitled - self.consumed

    @property
    def buffer(self) -> int:
        return max(1, int(math.ceil(self.entitled * RECLAIM_BUFFER_PCT)))

    def nearest_expiry(self) -> Optional[datetime]:
        dates = [l.expiry_date for l in self.valid if l.expiry_date]
        return min(dates) if dates else None

    @property
    def detected(self) -> bool:
        """At least one install / seat of this product is on record. Without that
        the inventory gives no evidence either way (an OS licence, a SaaS tenant or
        simply an unscanned estate has no install footprint), so a surplus must not
        be reported as shelfware."""
        return self.assignments > 0

    def status(self, now: datetime, ignore_expiry: bool = False) -> str:
        if not self.valid:
            return "expired" if any(s == "expired" for s in self.states.values()) else "pending"
        if not self.measured:
            return "not_measured"
        if self.position < 0:
            return "over_deployed"
        ne = self.nearest_expiry()
        if not ignore_expiry and ne and _expiry_end(ne) <= now + timedelta(days=EXPIRING_DAYS):
            return "expiring_soon"
        if not self.detected:
            return "not_detected"
        if not self.unlimited and self.position > self.buffer:
            return "over_licensed"
        return "compliant"

    def reclaimable(self) -> int:
        if not self.measured or not self.valid or not self.detected:
            return 0
        surplus = 0 if self.unlimited else max(0, self.position - self.buffer)
        return int(self.stale_seats + surplus)

    def exposure(self) -> Optional[float]:
        if not self.measured or self.position >= 0:
            return 0.0
        if self.unit_cost is None:
            return None  # shortfall is real, its price is unknown — never fabricate 0
        return _round(abs(self.position) * self.unit_cost)


def _group_key(line: LicenseEntitlement) -> tuple:
    root = M.pub_root(line.publisher)
    toks = M.name_tokens(line.product)
    if len(toks) > 1 and toks[0] == root:
        toks = toks[1:]                      # "Microsoft Office" and "Office" (publisher Microsoft) are one pool
    prod = "-".join(toks) or M.clean(line.product).lower()
    return (root, prod, M.name_key(line.edition), line.license_metric)


def _load_lines(db: Session, tenant_id: int) -> List[LicenseEntitlement]:
    return (db.query(LicenseEntitlement)
            .filter(LicenseEntitlement.tenant_id == tenant_id)
            .order_by(LicenseEntitlement.id).all())


def _build_groups(lines: Sequence[LicenseEntitlement], now: datetime) -> List[_Group]:
    groups: Dict[tuple, _Group] = {}
    for line in lines:
        if line.status == "retired":
            continue
        k = _group_key(line)
        g = groups.get(k)
        if g is None:
            g = groups[k] = _Group(len(groups), k, line)
        g.lines.append(line)
        g.states[line.id] = _line_state(line, now)
    out = list(groups.values())
    for g in out:
        g.finish(now)
    return out


# ── the reconciliation engine ───────────────────────────────────────────────

_LOCKS: Dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()
_LAST_REBUILD: Dict[str, float] = {}
_LAST_STATS: Dict[str, Dict[str, Any]] = {}
_LAST_FP: Dict[str, tuple] = {}


def _cache_key(db: Session, tenant_id: int) -> str:
    return f"{_bind_key(db)}|{tenant_id}"


def _local_lock(key: str) -> threading.RLock:
    with _LOCKS_GUARD:
        lk = _LOCKS.get(key)
        if lk is None:
            lk = _LOCKS[key] = threading.RLock()
        return lk


def _pg_advisory_lock(db: Session, tenant_id: int) -> None:
    """Serialise rebuilds across workers for this tenant (xact-scoped: released by
    the commit/rollback that ends the rebuild). No-op off PostgreSQL."""
    if db.get_bind().dialect.name != "postgresql":
        return
    db.execute(text("SELECT pg_advisory_xact_lock(:c, hashtext(:k))"),
               {"c": 7411, "k": f"grc:license_rebuild:{tenant_id}"})


def _iter_inventory_assets(db: Session, tenant_id: int, chunk: int = 200) -> Iterator[Any]:
    """Inventory assets (transient AI-pentest ad-hoc targets are not inventory),
    keyset-paged so a big estate's software blobs are never all in memory."""
    A = ITAsset
    last = 0
    while True:
        rows = (db.query(A.id, A.name, A.host_name, A.detected_software_json, A.cpu_cores,
                         A.assigned_user, A.last_seen_at, A.lifecycle_state, A.status, A.asset_role)
                .filter(A.tenant_id == tenant_id, A.id > last,
                        func.coalesce(A.status, "") != "adhoc",
                        func.coalesce(A.last_seen_source, "") != "pentest-adhoc")
                .order_by(A.id).limit(chunk).all())
        if not rows:
            return
        for r in rows:
            yield r
        last = rows[-1].id


def _load_cpu_sections(db: Session, tenant_id: int) -> Dict[int, Any]:
    A = ITAsset
    out: Dict[int, Any] = {}
    for aid, cpu in db.query(A.id, A.platform_properties["cpu"]).filter(A.tenant_id == tenant_id):
        if cpu:
            out[aid] = cpu
    return out


def _cpu_counts(section: Any, logical_cores: Optional[int]) -> Tuple[Optional[int], Optional[int]]:
    """(cores, sockets) for core/socket metrics. Physical cores win over the
    logical-processor count stored on the asset (hyper-threading would otherwise
    inflate a per-core requirement)."""
    data = section.get("data") if isinstance(section, dict) else None
    data = data if isinstance(data, dict) else {}
    sockets = _as_int(data.get("sockets"))
    physical = _as_int(data.get("physical_cores"))
    if physical is None:                                   # Linux lscpu strings
        per_socket = _as_int(data.get("cores_per_socket"))
        if per_socket and sockets:
            physical = per_socket * sockets
    cores = physical or _as_int(logical_cores) or _as_int(data.get("logical_processors")) \
        or _as_int(data.get("cpus"))
    return (cores if cores and cores > 0 else None, sockets if sockets and sockets > 0 else None)


def _norm_user(value: Any) -> str:
    u = M.clean(value).lower()
    if u in {"", "none", "null", "-", "system", "nt authority\\system", "local service", "network service"}:
        return ""
    return u


def _units(g: _Group, user: str, cores: Optional[int], sockets: Optional[int]) -> Tuple[int, Optional[str]]:
    """Seats this install consumes in `g`, plus an annotation when it was a guess."""
    if not g.measured:
        return 0, "Counted for reference only: this licence metric cannot be measured from installed-software inventory."
    if g.metric == "per_core":
        return (cores, None) if cores else (1, "Core count not collected - counted as 1.")
    if g.metric in ("per_socket", "per_processor"):
        return (sockets, None) if sockets else (1, "Socket count not collected - counted as 1.")
    if g.metric == "per_user_named":
        if user and user in g.users:
            return 0, "User already counted on another device."
        return 1, (None if user else "No assigned user recorded - counted as one named user.")
    return 1, None   # per_device / per_installation


def _candidates(inst: Dict[str, Any], groups: Sequence[_Group], memo: Dict[tuple, List[_Group]]) -> List[_Group]:
    mk = (inst["name_key"], inst["pub_root"], inst["keys"])
    hit = memo.get(mk)
    if hit is not None:
        return hit
    # best match tier among the pools that can licence (live lines) and, separately,
    # among those that cannot (all expired / not started): a stronger match on a
    # lapsed pool must not hide a weaker match on a live one.
    live: List[_Group] = []
    lapsed: List[_Group] = []
    best_live: Optional[int] = None
    best_lapsed: Optional[int] = None
    for g in groups:
        t = g.desc.tier(inst) if g.desc else None
        if t is None:
            continue
        if g.valid:
            if best_live is None or t < best_live:
                best_live, live = t, [g]
            elif t == best_live:
                live.append(g)
        else:
            if best_lapsed is None or t < best_lapsed:
                best_lapsed, lapsed = t, [g]
            elif t == best_lapsed:
                lapsed.append(g)
    found = live or lapsed
    # measurable pools before unmeasurable ones, then stable
    found.sort(key=lambda g: (0 if g.measured else 1, g.idx))
    memo[mk] = found
    return found


# Column order of a bulk-inserted assignment row (see _insert_rows).
_INSERT_COLS = ("tenant_id", "entitlement_id", "asset_id", "software_key", "user_identifier",
                "detected_name", "detected_version", "quantity_consumed", "assignment_source",
                "is_reclaim_candidate", "assigned_at", "assigned_by", "notes")


def _is_pg(db: Session) -> bool:
    return db.get_bind().dialect.name == "postgresql"


def _delete_ids(db: Session, ids: List[int]) -> None:
    pg = _is_pg(db)
    step = 10000 if pg else 500
    for i in range(0, len(ids), step):
        chunk = ids[i:i + step]
        if pg:
            db.execute(text("DELETE FROM grc_license_assignments WHERE id = ANY(:ids)"), {"ids": chunk})
        else:
            db.query(LicenseAssignment).filter(LicenseAssignment.id.in_(chunk)).delete(synchronize_session=False)


def _insert_rows(db: Session, rows: List[tuple]) -> None:
    """Bulk insert, rows in _INSERT_COLS order. PostgreSQL goes through COPY (a
    first rebuild of a few hundred thousand seats takes seconds, not minutes);
    other dialects use a plain executemany. None -> NULL (unquoted empty CSV field);
    no value written here is ever an empty string."""
    if not rows:
        return
    if _is_pg(db):
        cols = ", ".join(_INSERT_COLS)
        cur = db.connection().connection.cursor()
        try:
            if hasattr(cur, "copy_expert"):                 # psycopg2
                for i in range(0, len(rows), 50000):
                    buf = io.StringIO()
                    csv.writer(buf, lineterminator="\n").writerows(rows[i:i + 50000])
                    buf.seek(0)
                    cur.copy_expert(f"COPY grc_license_assignments ({cols}) FROM STDIN WITH (FORMAT csv)", buf)
                return
        finally:
            cur.close()
    table = LicenseAssignment.__table__
    for i in range(0, len(rows), _CHUNK):
        db.execute(table.insert(), [dict(zip(_INSERT_COLS, r)) for r in rows[i:i + _CHUNK]])


# A desired assignment is keyed (entitlement_id | None, asset_id, software_key) and
# valued with this tuple (tuples, not dicts: an estate can hold 100k+ of them).
_VALUE_FIELDS = ("user_identifier", "detected_name", "detected_version",
                 "quantity_consumed", "is_reclaim_candidate", "notes")


def _plan(db: Session, tenant_id: int, groups: List[_Group], now: datetime,
          line_group: Dict[int, _Group]) -> Tuple[Dict[tuple, tuple], Dict[str, int]]:
    """Derive the desired auto assignments from the current inventory."""
    stats = {"assets": 0, "assets_with_inventory": 0, "installs": 0}
    desired: Dict[tuple, tuple] = {}

    # manual/import seats are authoritative: their asset already consumes that pool
    taken: Set[Tuple[int, int]] = set()
    for ent_id, asset_id, qty in (db.query(LicenseAssignment.entitlement_id, LicenseAssignment.asset_id,
                                           LicenseAssignment.quantity_consumed)
                                  .filter(LicenseAssignment.tenant_id == tenant_id,
                                          LicenseAssignment.assignment_source != "auto_match",
                                          LicenseAssignment.entitlement_id.isnot(None))):
        g = line_group.get(ent_id)
        if g is not None and asset_id is not None:
            taken.add((g.idx, asset_id))
            g.running += int(qty or 0)

    cpu_by_asset = _load_cpu_sections(db, tenant_id) if any(g.cpu_metric and g.valid for g in groups) else {}
    stale_cut = now - timedelta(days=STALE_DAYS)
    memo: Dict[tuple, List[_Group]] = {}
    installs: Dict[tuple, Optional[Dict[str, Any]]] = {}   # most hosts share most of their software

    for a in _iter_inventory_assets(db, tenant_id):
        stats["assets"] += 1
        sw = a.detected_software_json
        if (a.asset_role or "") == "application" or not isinstance(sw, list) or not sw:
            continue
        stats["assets_with_inventory"] += 1
        host_retired = ((a.lifecycle_state or "").lower() in RETIRED_HOST_STATES
                        or (a.status or "").lower() in RETIRED_HOST_STATES)
        stale = host_retired or bool(a.last_seen_at and a.last_seen_at < stale_cut)
        user = _norm_user(a.assigned_user)
        cores, sockets = _cpu_counts(cpu_by_asset.get(a.id), a.cpu_cores)
        seen: Set[str] = set()
        matched: Set[int] = set()

        for entry in sw:
            if not isinstance(entry, dict):
                continue
            ik = (entry.get("name"), entry.get("version"), entry.get("publisher"),
                  entry.get("source"), entry.get("software_key"))
            try:
                inst = installs[ik]
            except KeyError:
                inst = installs[ik] = M.read_install(entry)
            except TypeError:                 # an unhashable value in a hand-edited blob
                inst = M.read_install(entry)
            if inst is None:
                continue
            stats["installs"] += 1
            if inst["name_key"] in seen:
                continue                      # duplicate rows of one product (locale / arch variants)
            seen.add(inst["name_key"])
            cands = _candidates(inst, groups, memo)
            valid = [g for g in cands if g.valid]

            if valid:
                if any((g.idx in matched) or ((g.idx, a.id) in taken) for g in valid):
                    continue                  # this asset already consumes one of the candidate pools
                pick: Optional[_Group] = None
                pick_u, pick_note = 0, None
                for g in valid:
                    u, note = _units(g, user, cores, sockets)
                    if g.unlimited or g.running + u <= g.entitled:
                        pick, pick_u, pick_note = g, u, note
                        break
                if pick is None:             # every candidate pool is full: overflow the first
                    pick = valid[0]
                    pick_u, pick_note = _units(pick, user, cores, sockets)
                pick.running += pick_u
                if user and pick.metric == "per_user_named":
                    pick.users.add(user)
                matched.add(pick.idx)
                desired.setdefault((pick.rep_id, a.id, inst["key"][:80]), (
                    (M.clean(a.assigned_user)[:255] or None) if pick.metric.startswith("per_user") else None,
                    inst["name"][:300], (inst["version"] or "")[:50] or None,
                    int(pick_u), bool(stale and pick_u > 0), pick_note,
                ))
                continue

            # no pool can license this install
            if inst["os_package"]:
                continue                      # never flag Linux distro packages as unlicensed
            note = None
            if cands:
                lapsed = cands[0]
                note = f"Matches '{lapsed.product}' but that entitlement is {('expired' if any(s == 'expired' for s in lapsed.states.values()) else 'not yet active')}."
            desired.setdefault((None, a.id, inst["key"][:80]), (
                None, inst["name"][:300], (inst["version"] or "")[:50] or None, 1, False, note,
            ))
    return desired, stats


def _rebuild_locked(db: Session, tenant_id: int) -> Dict[str, Any]:
    t0 = time.monotonic()
    now = _now()
    _pg_advisory_lock(db, tenant_id)
    groups = _build_groups(_load_lines(db, tenant_id), now)
    line_group = {l.id: g for g in groups for l in g.lines}
    desired, stats = _plan(db, tenant_id, groups, now, line_group)

    A = LicenseAssignment
    rows = (db.query(A.id, A.entitlement_id, A.asset_id, A.software_key, A.user_identifier,
                     A.detected_name, A.detected_version, A.quantity_consumed,
                     A.is_reclaim_candidate, A.notes)
            .filter(A.tenant_id == tenant_id, A.assignment_source == "auto_match").all())
    existing: Dict[tuple, Any] = {}
    to_delete: List[int] = []
    for r in rows:
        k = (r.entitlement_id, r.asset_id, r.software_key)
        if k in existing:
            to_delete.append(r.id)            # a duplicate from an old race
        else:
            existing[k] = r
    to_delete += [r.id for k, r in existing.items() if k not in desired]
    new_keys = [k for k in desired if k not in existing]
    # A changed row is replaced (delete + insert): both are bulk-fast, a per-row UPDATE is not.
    changed_keys = []
    for k, v in desired.items():
        r = existing.get(k)
        if r is not None and tuple(getattr(r, f) for f in _VALUE_FIELDS) != v:
            to_delete.append(r.id)
            changed_keys.append(k)

    _delete_ids(db, to_delete)
    _insert_rows(db, [
        (tenant_id, k[0], k[1], k[2], v[0], v[1], v[2], v[3], "auto_match", v[4], now, "system", v[5])
        for k, v in ((k, desired[k]) for k in new_keys + changed_keys)
    ])
    db.commit()

    stats.update({
        "assignments": len(desired),
        "unlicensed": sum(1 for k in desired if k[0] is None),
        "inserted": len(new_keys), "updated": len(changed_keys),
        "deleted": len(to_delete) - len(changed_keys),
        "duration_ms": int((time.monotonic() - t0) * 1000),
        "at": now.isoformat(),
    })
    return stats


_FP_SQL = text("""
    SELECT count(*),
           coalesce(sum(hashtext(concat_ws('|', id::text, coalesce(detected_software_json::text, ''),
                coalesce(assigned_user, ''), coalesce(cpu_cores::text, ''), coalesce(lifecycle_state, ''),
                coalesce(status, ''), coalesce(asset_role, ''),
                (coalesce(last_seen_at < :cut, false))::text,
                coalesce((platform_properties->'cpu')::text, '')))::bigint), 0)::text
    FROM grc_it_assets
    WHERE tenant_id = :t AND coalesce(status, '') <> 'adhoc' AND coalesce(last_seen_source, '') <> 'pentest-adhoc'
""")


def _fingerprint(db: Session, tenant_id: int) -> Optional[tuple]:
    """A cheap digest of every INPUT the reconciliation reads (entitlement lines and
    their live/expired state, each inventory asset's software + the columns that
    drive units/staleness, manual seats), hashed server-side so an unchanged estate
    costs one scan instead of shipping every software blob to Python. None off
    PostgreSQL (callers then always rebuild)."""
    if not _is_pg(db):
        return None
    now = _now()
    lines = _load_lines(db, tenant_id)
    sig = repr([(l.id, l.publisher, l.product, l.edition, l.license_metric, l.license_type, l.total_quantity,
                 l.software_key, l.status, _iso(l.start_date), _iso(l.expiry_date), _line_state(l, now))
                for l in lines])
    n, h = db.execute(_FP_SQL, {"t": tenant_id, "cut": now - timedelta(days=STALE_DAYS)}).one()
    man = db.execute(text(
        "SELECT count(*), coalesce(sum(quantity_consumed), 0), coalesce(max(id), 0) FROM grc_license_assignments "
        "WHERE tenant_id = :t AND assignment_source <> 'auto_match'"), {"t": tenant_id}).one()
    return (hashlib.md5(sig.encode("utf-8")).hexdigest(), int(n), h, tuple(int(x) for x in man))


def _auto_count(db: Session, tenant_id: int) -> int:
    A = LicenseAssignment
    return int(db.query(func.count(A.id)).filter(A.tenant_id == tenant_id,
                                                  A.assignment_source == "auto_match").scalar() or 0)


def rebuild_assignments(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Re-derive this tenant's auto assignments from every asset's
    detected_software_json and write the difference (write-on-change). Always
    runs; read paths go through refresh_if_stale() which debounces it."""
    ensure_tables(db)
    key = _cache_key(db, tenant_id)
    with _local_lock(key):
        try:
            fp = _fingerprint(db, tenant_id)      # taken BEFORE reading: a change mid-rebuild re-triggers
            stats = _rebuild_locked(db, tenant_id)
        except Exception:
            db.rollback()
            raise
        _LAST_REBUILD[key] = time.monotonic()
        _LAST_STATS[key] = stats
        _LAST_FP[key] = (fp, stats["assignments"]) if fp is not None else None
        return stats


def refresh_if_stale(db: Session, tenant_id: int, force: bool = False) -> None:
    """Refresh-on-read. Never raises: a failed refresh leaves the previous
    assignments in place (stale, not broken) and is logged."""
    try:
        ensure_tables(db)
        changed = sweep_expired(db, tenant_id)
        key = _cache_key(db, tenant_id)
        with _local_lock(key):
            fresh = (time.monotonic() - _LAST_REBUILD.get(key, -1e9)) < REBUILD_TTL_SECONDS
            if force or changed:
                rebuild_assignments(db, tenant_id)
            elif not fresh:
                last = _LAST_FP.get(key)
                fp = _fingerprint(db, tenant_id) if last else None
                if last and fp is not None and fp == last[0] and _auto_count(db, tenant_id) == last[1]:
                    _LAST_REBUILD[key] = time.monotonic()      # verified unchanged: nothing to re-derive
                else:
                    rebuild_assignments(db, tenant_id)
    except Exception:  # noqa: BLE001
        logger.exception("license reconciliation refresh failed for tenant %s", tenant_id)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


def _rebuild_quietly(db: Session, tenant_id: int) -> None:
    refresh_if_stale(db, tenant_id, force=True)


# ── reading the position ────────────────────────────────────────────────────

class _State:
    def __init__(self, now: datetime):
        self.now = now
        self.lines: List[LicenseEntitlement] = []
        self.groups: List[_Group] = []
        self.line_group: Dict[int, _Group] = {}
        self.unlicensed_installs = 0
        self.unlicensed: List[Dict[str, Any]] = []     # aggregated, with_assets only
        self.names: Dict[int, str] = {}
        self.stats: Dict[str, Any] = {}


def _asset_names(db: Session, tenant_id: int, ids: Sequence[int]) -> Dict[int, str]:
    out: Dict[int, str] = {}
    ids = sorted(set(i for i in ids if i is not None))
    for i in range(0, len(ids), _CHUNK):
        for aid, name, host in (db.query(ITAsset.id, ITAsset.name, ITAsset.host_name)
                                .filter(ITAsset.tenant_id == tenant_id, ITAsset.id.in_(ids[i:i + _CHUNK]))):
            out[aid] = name or host or f"asset-{aid}"
    return out


def _load_state(db: Session, tenant_id: int, with_assets: bool) -> _State:
    now = _now()
    st = _State(now)
    st.lines = _load_lines(db, tenant_id)
    st.groups = _build_groups(st.lines, now)
    st.line_group = {l.id: g for g in st.groups for l in g.lines}
    st.stats = dict(_LAST_STATS.get(_cache_key(db, tenant_id), {}))
    A = LicenseAssignment

    if with_assets:
        rows = (db.query(A.entitlement_id, A.asset_id, A.quantity_consumed, A.is_reclaim_candidate)
                .filter(A.tenant_id == tenant_id, A.entitlement_id.isnot(None)).all())
        for r in rows:
            g = st.line_group.get(r.entitlement_id)
            if g is None:
                continue
            q = int(r.quantity_consumed or 0)
            g.consumed += q
            g.assignments += 1
            if r.is_reclaim_candidate:
                g.stale_seats += q
            if r.asset_id is not None:
                g.assets[r.asset_id] += q
        st.unlicensed, sample_names, st.unlicensed_installs = _unlicensed_aggregates(db, tenant_id)
        st.names = dict(sample_names)
        st.names.update(_asset_names(db, tenant_id, [r.asset_id for r in rows if r.asset_id not in sample_names]))
    else:
        agg = (db.query(A.entitlement_id, func.count(A.id),
                        func.coalesce(func.sum(A.quantity_consumed), 0),
                        func.coalesce(func.sum(case((A.is_reclaim_candidate.is_(True), A.quantity_consumed),
                                                    else_=0)), 0))
               .filter(A.tenant_id == tenant_id, A.entitlement_id.isnot(None))
               .group_by(A.entitlement_id).all())
        for ent_id, n, consumed, stale in agg:
            g = st.line_group.get(ent_id)
            if g is not None:
                g.assignments += int(n or 0)
                g.consumed += int(consumed or 0)
                g.stale_seats += int(stale or 0)
        st.unlicensed_installs = int(db.query(func.count(A.id))
                                     .filter(A.tenant_id == tenant_id, A.entitlement_id.is_(None)).scalar() or 0)
    return st


def _sort_rows(rows: List[Dict[str, Any]]) -> None:
    def key(r: Dict[str, Any]):
        rank = _STATUS_RANK.get(r["status"], 9)
        if r["status"] == "over_deployed":
            sec = (-(r.get("exposure_cost") or 0.0), r["position"])
        elif r["status"] == "expiring_soon":
            sec = (r.get("nearest_expiry") or "", 0)
        elif r["status"] == "over_licensed":
            sec = (-(r.get("reclaimable_count") or 0), 0)
        else:
            sec = (0, 0)
        return (rank, sec, (r["publisher"] or "").lower(), (r["product"] or "").lower())
    rows.sort(key=key)


def compute_license_positions(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Per (publisher, product, edition, metric) ELP + the unlicensed list.

    entitled = Σ quantity of active, started, unexpired lines
    consumed = Σ quantity_consumed of the assignments on those lines
    position = entitled - consumed

    status: over_deployed (position < 0) > expiring_soon (nearest expiry <= 90d)
    > not_detected (no install of it on record: position unverifiable) >
    over_licensed (surplus beyond a 10% buffer) > compliant; not_measured for
    metrics ComplyVerse cannot count; expired / pending for pools with no live line."""
    refresh_if_stale(db, tenant_id)
    st = _load_state(db, tenant_id, with_assets=True)
    now = st.now

    positions: List[Dict[str, Any]] = []
    for g in st.groups:
        cons = sorted(g.assets.items(), key=lambda kv: (-kv[1], st.names.get(kv[0], "").lower(), kv[0]))
        positions.append({
            "publisher": g.publisher, "product": g.product, "edition": g.edition,
            "license_metric": g.metric,
            "entitled": g.effective_entitled, "consumed": g.consumed, "position": g.position,
            "status": g.status(now),
            "unit_cost": _round(g.unit_cost, 4), "exposure_cost": g.exposure(),
            "reclaimable_count": g.reclaimable(),
            "nearest_expiry": _iso(g.nearest_expiry()),
            "consuming_assets": [{"asset_id": aid, "name": st.names.get(aid, f"asset-{aid}"), "quantity": q}
                                 for aid, q in cons[:MAX_CONSUMING_ASSETS]],
            # extras
            "currency": g.currency, "measured": g.measured,
            "entitlement_ids": sorted(g.line_ids),
            "consuming_assets_total": len(cons),
        })
    _sort_rows(positions)
    unlicensed = _unlicensed(st)
    attach_publishers(db, tenant_id, unlicensed)
    return {"positions": positions, "unlicensed": unlicensed}


def _unlicensed_aggregates(db: Session, tenant_id: int) -> Tuple[List[Dict[str, Any]], Dict[int, str], int]:
    """The unlicensed installs, aggregated in SQL (a big estate holds hundreds of
    thousands of these rows): per product (version / arch / locale variants merged
    on the normalised name) the install count, name/key votes, a note, and up to
    MAX_UNLICENSED_ASSETS sample assets. Returns (groups, {sample asset id: name},
    total)."""
    A = LicenseAssignment
    agg = (db.query(A.software_key, A.detected_name, func.count(A.id), func.max(A.notes))
           .filter(A.tenant_id == tenant_id, A.entitlement_id.is_(None))
           .group_by(A.software_key, A.detected_name).all())
    if not agg:
        return [], {}, 0
    rn = func.row_number().over(partition_by=A.software_key, order_by=A.asset_id).label("rn")
    sub = (db.query(A.software_key.label("k"), A.asset_id.label("aid"), rn)
           .filter(A.tenant_id == tenant_id, A.entitlement_id.is_(None)).subquery())
    samples: Dict[str, List[int]] = defaultdict(list)
    names: Dict[int, str] = {}
    for k, aid, name, host in (db.query(sub.c.k, sub.c.aid, ITAsset.name, ITAsset.host_name)
                               .join(ITAsset, ITAsset.id == sub.c.aid)
                               .filter(sub.c.rn <= MAX_UNLICENSED_ASSETS)):
        samples[k].append(aid)
        names[aid] = name or host or f"asset-{aid}"

    by_name: Dict[str, Dict[str, Any]] = {}
    total = 0
    for key, name, cnt, note in agg:
        total += int(cnt)
        g = by_name.setdefault(M.name_key(name) or (key or ""), {
            "count": 0, "names": Counter(), "keys": Counter(), "note": None})
        g["count"] += int(cnt)
        g["names"][name] += int(cnt)
        g["keys"][key] += int(cnt)
        g["note"] = g["note"] or note
    out: List[Dict[str, Any]] = []
    for g in by_name.values():
        ids: List[int] = []
        seen: Set[int] = set()
        for key, _ in g["keys"].most_common():
            for aid in samples.get(key, []):
                if aid not in seen:
                    seen.add(aid)
                    ids.append(aid)
        g["asset_ids"] = ids[:MAX_UNLICENSED_ASSETS]
        out.append(g)
    return out, names, total


def _unlicensed(st: _State) -> List[Dict[str, Any]]:
    """Installs with no valid entitlement, one entry per product, biggest footprint first."""
    out: List[Dict[str, Any]] = []
    for g in st.unlicensed:
        # most common name, ties -> shortest (the unversioned one)
        name = sorted(g["names"].items(), key=lambda kv: (-kv[1], len(kv[0] or ""), kv[0] or ""))[0][0] or ""
        assets = [{"asset_id": aid, "name": st.names.get(aid, f"asset-{aid}")} for aid in g["asset_ids"]]
        assets.sort(key=lambda a: (a["name"].lower(), a["asset_id"]))
        out.append({
            "software_key": g["keys"].most_common(1)[0][0] or "",
            "name": name,
            "publisher": None,   # filled by attach_publishers
            "install_count": g["count"],
            "assets": assets,
            # extras (a product present on one asset appears once per asset, so this is also the asset count)
            "assets_total": g["count"],
            "reason": "entitlement_expired" if g["note"] else "no_entitlement",
            "note": g["note"],
        })
    out.sort(key=lambda u: (-u["install_count"], u["name"].lower()))
    return out


def attach_publishers(db: Session, tenant_id: int, unlicensed: List[Dict[str, Any]]) -> None:
    """The assignment table stores no publisher, so recover it from a sample asset's
    own software list (cheap: one asset per product, capped)."""
    wanted: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for u in unlicensed:
        if u["assets"]:
            wanted[u["assets"][0]["asset_id"]].append(u)
    if not wanted:
        return
    ids = list(wanted)
    for i in range(0, len(ids), 200):
        for aid, sw in (db.query(ITAsset.id, ITAsset.detected_software_json)
                        .filter(ITAsset.tenant_id == tenant_id, ITAsset.id.in_(ids[i:i + 200]))):
            if not isinstance(sw, list):
                continue
            by_key = {}
            for e in sw:
                inst = M.read_install(e)
                if inst and inst["publisher"]:
                    by_key.setdefault(inst["key"], inst["publisher"])
                    by_key.setdefault(inst["name_key"], inst["publisher"])
            for u in wanted[aid]:
                u["publisher"] = by_key.get(u["software_key"]) or by_key.get(M.name_key(u["name"]))


# ── summary (exec-dashboard card) ───────────────────────────────────────────

def _line_cost(l: LicenseEntitlement) -> Optional[float]:
    if l.unit_cost is None or not l.total_quantity:
        return None
    return float(l.total_quantity) * float(l.unit_cost)


def _is_recurring(l: LicenseEntitlement) -> bool:
    if l.license_type in ("subscription", "saas"):
        return True
    return l.expiry_date is not None and l.license_type not in ("perpetual", "oem", "open_source", "trial")


def _annualised(l: LicenseEntitlement) -> Optional[float]:
    cost = _line_cost(l)
    if cost is None:
        return None
    if l.start_date and l.expiry_date:
        days = (_expiry_end(l.expiry_date) - l.start_date).days
        if days > 0:
            return cost * 365.0 / days
    return cost  # no term recorded: price is taken as the yearly price


def _next_event(l: LicenseEntitlement, now: datetime) -> Optional[datetime]:
    """Soonest upcoming licence expiry / maintenance expiry of a live line."""
    ev = [_expiry_end(d) for d in (l.expiry_date, l.maintenance_expiry) if d]
    ev = [d for d in ev if d >= now]
    return min(ev) if ev else None


def compute_summary(db: Session, tenant_id: int) -> Dict[str, Any]:
    """The dashboard card. Invariant: compliant + over_deployed == tracked_products
    (tracked = products with a live entitlement, a metric scans can count AND at
    least one install on record; the rest are reported separately as
    not_measured_products / not_detected_products). Money is reported in the
    tenant's primary currency (`currency`); `by_currency` carries every currency
    so nothing is silently summed across currencies."""
    refresh_if_stale(db, tenant_id)
    st = _load_state(db, tenant_id, with_assets=False)
    now = st.now

    tracked = [g for g in st.groups if g.valid and g.measured and g.detected]
    over = [g for g in tracked if g.position < 0]
    compliant = len(tracked) - len(over)
    status_counts = Counter(g.status(now) for g in st.groups)

    # money per currency ------------------------------------------------------
    spend: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    live = [l for g in st.groups for l in g.valid]
    for l in live:
        cur = l.currency or "USD"
        if _is_recurring(l):
            a = _annualised(l)
            if a is not None:
                spend[cur]["annual_spend"] += a
            cost = _line_cost(l)
            if l.expiry_date and cost is not None and now <= _expiry_end(l.expiry_date) <= now + timedelta(days=90):
                spend[cur]["renewal_cost_90d"] += cost
    for g in st.groups:
        if g.unit_cost is not None:
            if g.reclaimable():
                spend[g.currency]["reclaimable_savings"] += g.reclaimable() * g.unit_cost
            exp = g.exposure()
            if exp:
                spend[g.currency]["exposure_cost"] += exp
    cur_weight = Counter()
    for l in live:
        c = _line_cost(l)
        if c:
            cur_weight[l.currency or "USD"] += c
    primary = (cur_weight.most_common(1)[0][0] if cur_weight
               else (live[0].currency if live else "USD")) or "USD"
    money = spend.get(primary, {})

    # expiry windows (cumulative) --------------------------------------------
    win = {30: 0, 60: 0, 90: 0}
    upcoming: List[Tuple[datetime, LicenseEntitlement]] = []
    for l in live:
        ev = _next_event(l, now)
        if ev is None:
            continue
        upcoming.append((ev, l))
        for d in win:
            if ev <= now + timedelta(days=d):
                win[d] += 1
    upcoming.sort(key=lambda t: t[0])

    offenders = sorted(over, key=lambda g: (-(g.exposure() or 0.0), g.position))[:5]
    expired_lines = sum(1 for g in st.groups for s in g.states.values() if s == "expired")

    return {
        "compliance_pct": round(100.0 * compliant / len(tracked), 1) if tracked else None,
        "tracked_products": len(tracked),
        "compliant": compliant,
        "over_deployed": len(over),
        # the plan uses both names for position < 0; kept as two keys, same count
        "under_licensed": len(over),
        "unlicensed_count": st.unlicensed_installs,
        "expiring_30": win[30], "expiring_60": win[60], "expiring_90": win[90],
        "annual_spend": _round(money.get("annual_spend", 0.0)) or 0.0,
        "renewal_cost_90d": _round(money.get("renewal_cost_90d", 0.0)) or 0.0,
        "reclaimable_count": int(sum(g.reclaimable() for g in st.groups)),
        "reclaimable_savings": _round(money.get("reclaimable_savings", 0.0)) or 0.0,
        # ── additive extras ──
        "currency": primary,
        "by_currency": {c: {k: _round(v) for k, v in m.items()} for c, m in spend.items()},
        "exposure_cost": _round(money.get("exposure_cost", 0.0)) or 0.0,
        "exposure_unpriced": sum(1 for g in over if g.exposure() is None),
        "licenses_short": int(sum(-g.position for g in over)),
        "expiring_soon_products": status_counts.get("expiring_soon", 0),
        "over_licensed_products": status_counts.get("over_licensed", 0),
        "not_measured_products": sum(1 for g in st.groups if g.valid and not g.measured),
        "not_detected_products": sum(1 for g in st.groups if g.valid and g.measured and not g.detected),
        "expired_lines": expired_lines,
        "entitlement_lines": sum(1 for l in st.lines if l.status != "retired"),
        "top_offenders": [{"publisher": g.publisher, "product": g.product, "edition": g.edition,
                           "position": g.position, "exposure_cost": g.exposure(), "currency": g.currency}
                          for g in offenders],
        "nearest_expiries": [{"id": l.id, "publisher": l.publisher, "product": l.product,
                              "edition": l.edition, "expiry": _iso(ev),
                              "days_left": max(0, int((ev - now).total_seconds() // 86400))}
                             for ev, l in upcoming[:5]],
        "assets_total": st.stats.get("assets"),
        "assets_with_inventory": st.stats.get("assets_with_inventory"),
        "as_of": now.isoformat(),
    }


# ── the register (GET /licenses) ────────────────────────────────────────────

def _line_dict(l: LicenseEntitlement, g: Optional[_Group], now: datetime) -> Dict[str, Any]:
    state = _line_state(l, now)
    live = g is not None and state == "active"
    if state != "active":
        status = state
    elif g is None:
        status = "pending"
    else:
        status = g.status(now)
        # per-line precision: only the line that is itself expiring says so
        if status == "expiring_soon" and not (
                l.expiry_date and _expiry_end(l.expiry_date) <= now + timedelta(days=EXPIRING_DAYS)):
            status = g.status(now, ignore_expiry=True)
    return {
        "id": l.id, "publisher": l.publisher, "product": l.product, "edition": l.edition,
        "license_type": l.license_type, "license_metric": l.license_metric,
        "total_quantity": l.total_quantity,
        "consumed": g.consumed if live else None,
        "position": g.position if live else None,
        "status": status,
        "unit_cost": l.unit_cost, "currency": l.currency,
        "purchase_date": _iso(l.purchase_date), "start_date": _iso(l.start_date),
        "expiry_date": _iso(l.expiry_date), "maintenance_expiry": _iso(l.maintenance_expiry),
        "po_reference": l.po_reference, "contract_reference": l.contract_reference,
        "reseller": l.reseller, "notes": l.notes,
        # extras
        "software_key": l.software_key,
        "maintenance_included": bool(l.maintenance_included),
        "support_level": l.support_level,
        "downgrade_rights": True if l.downgrade_rights is None else bool(l.downgrade_rights),
        "has_product_key": bool(l.product_key),
        "lifecycle_status": l.status,
        "product_entitled": g.effective_entitled if live else None,
        "measured": (g.measured if g is not None else l.license_metric in MEASURED_METRICS),
        "created_at": _iso(l.created_at), "updated_at": _iso(l.updated_at), "created_by": l.created_by,
    }


def list_entitlements(db: Session, tenant_id: int) -> Dict[str, Any]:
    refresh_if_stale(db, tenant_id)
    st = _load_state(db, tenant_id, with_assets=False)
    lines = sorted(st.lines, key=lambda l: ((l.publisher or "").lower(), (l.product or "").lower(),
                                            (l.edition or "").lower(), l.id))
    return {"entitlements": [_line_dict(l, st.line_group.get(l.id), st.now) for l in lines]}


# ── per-asset view (asset-detail "Licenses" tab) ────────────────────────────

_ASSET_STATUS_RANK = {"unlicensed": 0, "over_deployed": 1, "expiring": 2, "licensed": 3}


def asset_licenses(db: Session, tenant_id: int, asset_id: int) -> Optional[Dict[str, Any]]:
    """Installed products of one asset with their license status. None when the
    asset is not in this tenant."""
    ensure_tables(db)
    asset = (db.query(ITAsset.id, ITAsset.name, ITAsset.detected_software_json)
             .filter(ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id).first())
    if asset is None:
        return None
    refresh_if_stale(db, tenant_id)
    st = _load_state(db, tenant_id, with_assets=False)
    now = st.now

    sw = asset.detected_software_json if isinstance(asset.detected_software_json, list) else []
    pub_by_key: Dict[str, str] = {}
    for e in sw:
        inst = M.read_install(e)
        if inst and inst["publisher"]:
            pub_by_key.setdefault(inst["key"], inst["publisher"])
            pub_by_key.setdefault(inst["name_key"], inst["publisher"])

    A = LicenseAssignment
    rows = (db.query(A.entitlement_id, A.software_key, A.detected_name, A.detected_version,
                     A.quantity_consumed, A.is_reclaim_candidate, A.notes)
            .filter(A.tenant_id == tenant_id, A.asset_id == asset_id).all())
    line_by_id = {l.id: l for l in st.lines}
    out: List[Dict[str, Any]] = []
    for r in rows:
        g = st.line_group.get(r.entitlement_id) if r.entitlement_id is not None else None
        line = line_by_id.get(r.entitlement_id) if r.entitlement_id is not None else None
        publisher = pub_by_key.get(r.software_key) or pub_by_key.get(M.name_key(r.detected_name))
        if g is None:
            status, gstatus = "unlicensed", None
        else:
            gstatus = g.status(now)
            if gstatus == "over_deployed":
                status = "over_deployed"
            elif gstatus == "expiring_soon":
                status = "expiring"
            else:
                status = "licensed"
            publisher = publisher or g.publisher
        out.append({
            "detected_name": r.detected_name, "detected_version": r.detected_version,
            "publisher": publisher, "software_key": r.software_key, "status": status,
            "entitlement_id": line.id if line else None,
            "entitlement_product": (f"{g.product} ({g.edition})" if g.edition else g.product) if g else None,
            # extras
            "quantity": int(r.quantity_consumed or 0),
            "license_metric": g.metric if g else None,
            "product_status": gstatus,
            "reclaim_candidate": bool(r.is_reclaim_candidate),
            "note": r.notes,
        })
    out.sort(key=lambda d: (_ASSET_STATUS_RANK.get(d["status"], 9), (d["detected_name"] or "").lower()))
    counts = Counter(d["status"] for d in out)
    return {
        "asset_id": asset.id, "asset_name": asset.name,
        "licenses": out,
        "summary": {"licensed": counts.get("licensed", 0), "unlicensed": counts.get("unlicensed", 0),
                    "over_deployed": counts.get("over_deployed", 0), "expiring": counts.get("expiring", 0),
                    "total": len(out)},
        "inventory_collected": bool(sw),
    }
