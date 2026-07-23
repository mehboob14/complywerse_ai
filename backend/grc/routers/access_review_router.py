"""Access Review / user-access certification API.

Orchestrates the modules in grc.modules.access_review over the models in
grc.models._40_access_review_models. Admin-gated (reuses the SSO router's
_require_admin). Mounted at /access-reviews.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Cookie, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_tenant_db
from ..models import (
    AccessReviewCampaign,
    AccessReviewEscalation,
    AccessReviewFinding,
    AccessReviewItem,
    AccessReviewRuleConfig,
    Evidence,
    GRCUser,
    Role,
    SoDRule,
    Tenant,
    UserRole,
)
from ..models import IdentityProviderConfig
from ..modules.access_review import checks as checks_mod
from ..modules.access_review import rule_catalog as rules_mod
from ..modules.access_review import enrichment as enrichment_mod
from ..modules.access_review import export as export_mod
from ..modules.access_review import google as google_mod
from ..modules.access_review import okta as okta_mod
from ..modules.access_review import ldap_ad as ldap_mod
from ..modules.access_review import sailpoint as sailpoint_mod
from ..modules.access_review import iga as iga_mod
from ..modules.access_review import apps as apps_mod
from ..modules.access_review import sampling as sampling_mod
from .sso_router import _get_config, _require_admin

# Reuse the shared evidence upload dir: backend/grc/uploads/evidence/<tenant_id>
_EVIDENCE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "evidence"
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/access-reviews", tags=["Access Review"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tenant_id(tenant_db: Session) -> int:
    row = tenant_db.query(Tenant).first()
    return row.id if row else 0


def _role_names_for_user(tenant_db: Session, user_id: int) -> List[str]:
    rows = (
        tenant_db.query(Role.name)
        .join(UserRole, UserRole.role_id == Role.id)
        .filter(UserRole.user_id == user_id)
        .all()
    )
    return [r[0] for r in rows]


def _campaign_or_404(tenant_db: Session, campaign_id: int, tenant_id: int) -> AccessReviewCampaign:
    c = (
        tenant_db.query(AccessReviewCampaign)
        .filter(AccessReviewCampaign.id == campaign_id, AccessReviewCampaign.tenant_id == tenant_id)
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return c


def _assert_not_completed(c: AccessReviewCampaign) -> None:
    """A completed campaign is a frozen audit record — block any mutation."""
    if c.status == "completed":
        raise HTTPException(
            status_code=400,
            detail="Campaign is completed and locked — it cannot be changed.",
        )


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CampaignCreate(BaseModel):
    name: str
    description: Optional[str] = None
    review_type: str = "user_access"
    sampling_method: str = "random"
    requested_sample_size: int = 25
    risk_filters: Dict[str, Any] = {}
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    due_date: Optional[datetime] = None


class DecisionIn(BaseModel):
    decision: str  # approved | revoke | exception
    comment: Optional[str] = None


class SoDRuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    role_a_id: int
    role_b_id: int
    severity: str = "high"


class FindingUpdate(BaseModel):
    status: str  # open | remediated | accepted_risk | false_positive
    remediation_note: Optional[str] = None


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

def _campaign_dict(c: AccessReviewCampaign) -> Dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "review_type": c.review_type,
        "status": c.status,
        "population_size": c.population_size,
        "sampling_method": c.sampling_method,
        "requested_sample_size": c.requested_sample_size,
        "risk_filters": c.risk_filters or {},
        "period_start": c.period_start.isoformat() if c.period_start else None,
        "period_end": c.period_end.isoformat() if c.period_end else None,
        "due_date": c.due_date.isoformat() if c.due_date else None,
        "exceptions_found": c.exceptions_found,
        "items_reviewed": c.items_reviewed,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "closed_at": c.closed_at.isoformat() if c.closed_at else None,
    }


def _item_dict(item: AccessReviewItem, findings: List[AccessReviewFinding]) -> Dict[str, Any]:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "username": item.username,
        "email": item.email,
        "display_name": item.display_name,
        "department": item.department,
        "designation": item.designation,
        "roles": item.roles_snapshot or [],
        "mfa_enabled": item.mfa_enabled,
        "account_enabled": item.account_enabled,
        "last_sign_in": item.last_sign_in.isoformat() if item.last_sign_in else None,
        "is_terminated": item.is_terminated,
        "termination_date": item.termination_date.isoformat() if item.termination_date else None,
        "is_privileged": item.is_privileged,
        "decision": item.decision,
        "decision_comment": item.decision_comment,
        "decision_at": item.decision_at.isoformat() if item.decision_at else None,
        "ai_recommendation": item.ai_recommendation,
        "ai_reason": item.ai_reason,
        "risk_score": item.risk_score,
        "is_anomaly": item.is_anomaly,
        "anomaly_note": item.anomaly_note,
        "evidence_id": item.evidence_id,
        "escalation_tier": item.escalation_tier,
        "escalated_to_id": item.escalated_to_id,
        "escalation_sent_at": item.escalation_sent_at.isoformat() if item.escalation_sent_at else None,
        "findings": [
            {
                "id": f.id,
                "type": f.finding_type,
                "severity": f.severity,
                "title": f.title,
                "detail": f.detail,
                "status": f.status,
                "remediation_note": f.remediation_note,
            }
            for f in findings
        ],
    }


# ---------------------------------------------------------------------------
# Campaign CRUD
# ---------------------------------------------------------------------------

@router.get("")
def list_campaigns(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    rows = (
        tenant_db.query(AccessReviewCampaign)
        .filter(AccessReviewCampaign.tenant_id == tid)
        .order_by(AccessReviewCampaign.created_at.desc())
        .all()
    )
    return {"campaigns": [_campaign_dict(c) for c in rows]}


@router.post("")
def create_campaign(
    payload: CampaignCreate,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = AccessReviewCampaign(
        tenant_id=tid,
        name=payload.name,
        description=payload.description,
        review_type=payload.review_type,
        sampling_method=payload.sampling_method,
        requested_sample_size=payload.requested_sample_size,
        risk_filters=payload.risk_filters or {},
        period_start=payload.period_start,
        period_end=payload.period_end,
        due_date=payload.due_date,
        created_by=admin.id,
        status="draft",
    )
    tenant_db.add(c)
    tenant_db.commit()
    return _campaign_dict(c)


# ---------------------------------------------------------------------------
# Dashboard — tenant-wide aggregate analytics across all campaigns.
# NOTE: declared BEFORE /{campaign_id} so "dashboard" isn't parsed as an id.
# ---------------------------------------------------------------------------

@router.get("/dashboard")
def dashboard(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    campaigns = tenant_db.query(AccessReviewCampaign).filter(AccessReviewCampaign.tenant_id == tid).all()
    items = tenant_db.query(AccessReviewItem).filter(AccessReviewItem.tenant_id == tid).all()
    findings = tenant_db.query(AccessReviewFinding).filter(AccessReviewFinding.tenant_id == tid).all()
    sod_rules = tenant_db.query(SoDRule).filter(SoDRule.tenant_id == tid).count()

    by_status: Dict[str, int] = {}
    for c in campaigns:
        by_status[c.status] = by_status.get(c.status, 0) + 1

    by_type: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    open_findings: List[AccessReviewFinding] = []
    open_by_campaign: Dict[int, set] = {}
    for f in findings:
        by_type[f.finding_type] = by_type.get(f.finding_type, 0) + 1
        by_severity[f.severity] = by_severity.get(f.severity, 0) + 1
        if (f.status or "open") == "open":
            open_findings.append(f)
            open_by_campaign.setdefault(f.campaign_id, set()).add(f.item_id)

    by_decision: Dict[str, int] = {}
    items_per_campaign: Dict[int, int] = {}
    for it in items:
        by_decision[it.decision] = by_decision.get(it.decision, 0) + 1
        items_per_campaign[it.campaign_id] = items_per_campaign.get(it.campaign_id, 0) + 1

    verdicts: Dict[str, int] = {}
    for c in campaigns:
        if c.status != "completed":
            continue
        uw = len(open_by_campaign.get(c.id, set()))
        sample = items_per_campaign.get(c.id, 0)
        v = "effective" if uw == 0 else (
            "deficient" if uw <= max(1, sample // 10) else "material_weakness"
        )
        verdicts[v] = verdicts.get(v, 0) + 1

    recent = sorted(campaigns, key=lambda c: c.created_at or datetime.min, reverse=True)[:6]
    active = sum(1 for c in campaigns if c.status not in ("completed", "archived", "draft"))
    reviewed = sum(1 for it in items if it.decision != "pending")

    return {
        "campaigns_total": len(campaigns),
        "active_reviews": active,
        "completed_reviews": by_status.get("completed", 0),
        "campaigns_by_status": by_status,
        "findings_total": len(findings),
        "findings_open": len(open_findings),
        "findings_by_type": by_type,
        "findings_by_severity": by_severity,
        "items_total": len(items),
        "items_reviewed": reviewed,
        "decisions": by_decision,
        "users_with_open_exceptions": len({f.item_id for f in open_findings}),
        "sod_rules": sod_rules,
        "verdicts": verdicts,
        "recent_campaigns": [
            {
                "id": c.id, "name": c.name, "status": c.status,
                "review_type": c.review_type, "population_size": c.population_size,
                "exceptions_found": c.exceptions_found,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in recent
        ],
    }


# ---------------------------------------------------------------------------
# Test population — fill grc_users WITHOUT Microsoft Entra, so the whole
# pipeline can be exercised on mock data. Declared before /{campaign_id}.
# ---------------------------------------------------------------------------

def _get_or_create_role(tenant_db: Session, tid: int, name: str) -> Role:
    r = tenant_db.query(Role).filter(Role.name == name).first()
    if not r:
        cols = {c.name for c in Role.__table__.columns}
        kw: Dict[str, Any] = {"name": name, "description": f"{name} (test)"}
        if "tenant_id" in cols:
            kw["tenant_id"] = tid
        if "is_system_role" in cols:
            kw["is_system_role"] = False
        r = Role(**kw)
        tenant_db.add(r)
        tenant_db.flush()
    return r


def _assign_role(tenant_db: Session, tid: int, user_id: int, role_id: int) -> None:
    exists = (
        tenant_db.query(UserRole)
        .filter(UserRole.user_id == user_id, UserRole.role_id == role_id)
        .first()
    )
    if not exists:
        cols = {c.name for c in UserRole.__table__.columns}
        kw: Dict[str, Any] = {"user_id": user_id, "role_id": role_id}
        if "tenant_id" in cols:
            kw["tenant_id"] = tid
        tenant_db.add(UserRole(**kw))


@router.get("/test-population/count")
def test_population_count(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    return {"total_users": tenant_db.query(GRCUser).count()}


@router.post("/test-population/generate")
def generate_test_population(
    count: int = 12,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Create N mock users with varied access attributes, deliberately spread so
    Run Checks produces every finding type. No Microsoft Entra involved."""
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    import random
    from .sso_router import _make_unloginable_hash

    count = max(1, min(int(count or 12), 200))
    FIRST = ["Aisha", "Omar", "Sara", "Liam", "Noah", "Mia", "Yusuf", "Hana",
             "Ravi", "Lena", "Diego", "Zara", "Tom", "Iris", "Kai", "Nora"]
    LAST = ["Khan", "Patel", "Garcia", "Smith", "Chen", "Ali", "Park", "Diaz",
            "Haddad", "Rossi", "Novak", "Kim"]
    DEPTS = ["Finance", "Sales", "Marketing", "HR", "Operations", "Legal", "IT", "Security"]
    admin_role = _get_or_create_role(tenant_db, tid, "Administrator")
    approver = _get_or_create_role(tenant_db, tid, "Approver")
    now = datetime.utcnow()
    base = tenant_db.query(GRCUser).count()
    created = 0
    for i in range(count):
        fn, ln = random.choice(FIRST), random.choice(LAST)
        email = f"{fn.lower()}.{ln.lower()}.{base + i + 1}@complyverse.io"
        if tenant_db.query(GRCUser).filter(GRCUser.email == email).first():
            continue
        u = GRCUser(
            username=email, email=email, password_hash=_make_unloginable_hash(),
            display_name=f"{fn} {ln}", is_active=True, account_enabled=True,
            department=random.choice(DEPTS), access_synced_at=now,
            mfa_enabled=random.random() > 0.25,
        )
        si = random.random()
        if si < 0.15:
            u.entra_last_sign_in = None                                   # never signed in
        elif si < 0.35:
            u.entra_last_sign_in = now - timedelta(days=random.randint(120, 500))  # stale
        else:
            u.entra_last_sign_in = now - timedelta(days=random.randint(0, 30))
        if random.random() < 0.15:
            u.termination_date = date.today() - timedelta(days=random.randint(5, 60))  # ghost
        tenant_db.add(u)
        tenant_db.flush()
        if random.random() < 0.18:                                        # privileged
            _assign_role(tenant_db, tid, u.id, admin_role.id)
            if random.random() < 0.5:
                _assign_role(tenant_db, tid, u.id, approver.id)           # SoD pair
        created += 1
    tenant_db.commit()
    return {"created": created, "total_users": tenant_db.query(GRCUser).count()}


@router.post("/test-population/import")
async def import_test_population(
    file: UploadFile = File(...),
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Upsert users from a CSV into grc_users. Columns (header row, * = required):
    email*, display_name, department, designation, mfa_enabled, account_enabled,
    termination_date (YYYY-MM-DD), last_sign_in (YYYY-MM-DD), roles (';'-separated).
    """
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    import csv as _csv
    import io as _io
    from .sso_router import _make_unloginable_hash

    raw = (await file.read()).decode("utf-8-sig", errors="ignore")
    reader = _csv.DictReader(_io.StringIO(raw))

    def _b(v):
        if v is None or str(v).strip() == "":
            return None
        return str(v).strip().lower() in ("1", "true", "yes", "y")

    def _d(v):
        v = (v or "").strip()
        try:
            return date.fromisoformat(v) if v else None
        except Exception:
            return None

    def _dt(v):
        v = (v or "").strip()
        if not v:
            return None
        try:
            return datetime.fromisoformat(v)
        except Exception:
            d = _d(v)
            return datetime.combine(d, datetime.min.time()) if d else None

    created = updated = 0
    errors: List[str] = []
    for idx, row in enumerate(reader, start=2):
        email = (row.get("email") or "").strip().lower()
        if not email:
            errors.append(f"row {idx}: missing email")
            continue
        u = tenant_db.query(GRCUser).filter(GRCUser.email == email).first()
        if not u:
            u = GRCUser(username=email, email=email,
                        password_hash=_make_unloginable_hash(), is_active=True)
            tenant_db.add(u)
            tenant_db.flush()
            created += 1
        else:
            updated += 1
        if row.get("display_name"):
            u.display_name = row["display_name"].strip()
        if row.get("department"):
            u.department = row["department"].strip()
        if row.get("designation"):
            u.designation = row["designation"].strip()
        mfa = _b(row.get("mfa_enabled"))
        if mfa is not None:
            u.mfa_enabled = mfa
        acct = _b(row.get("account_enabled"))
        u.account_enabled = acct if acct is not None else True
        term = _d(row.get("termination_date"))
        if term:
            u.termination_date = term
        si = _dt(row.get("last_sign_in"))
        if si:
            u.entra_last_sign_in = si
        u.access_synced_at = datetime.utcnow()
        tenant_db.flush()
        roles_raw = row.get("roles") or ""
        sep = ";" if ";" in roles_raw else ","
        for rn in [r.strip() for r in roles_raw.split(sep) if r.strip()]:
            role = _get_or_create_role(tenant_db, tid, rn)
            _assign_role(tenant_db, tid, u.id, role.id)
    tenant_db.commit()
    return {
        "created": created, "updated": updated,
        "errors": errors[:20], "total_users": tenant_db.query(GRCUser).count(),
    }


# ---------------------------------------------------------------------------
# Spreadsheet (Excel / CSV) — a first-class population source for orgs that
# have no IAM and track access in a sheet.
# ---------------------------------------------------------------------------

def _rows_from_upload(filename: Optional[str], raw: bytes) -> List[Dict[str, Any]]:
    name = (filename or "").lower()
    if name.endswith(".xlsx") or raw[:2] == b"PK":          # xlsx is a zip
        import io as _io
        import openpyxl
        wb = openpyxl.load_workbook(_io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        it = ws.iter_rows(values_only=True)
        try:
            header = [str(h).strip() if h is not None else "" for h in next(it)]
        except StopIteration:
            return []
        out: List[Dict[str, Any]] = []
        for r in it:
            out.append({header[i]: ("" if v is None else str(v))
                        for i, v in enumerate(r) if i < len(header) and header[i]})
        return out
    import csv as _csv
    import io as _io
    return list(_csv.DictReader(_io.StringIO(raw.decode("utf-8-sig", errors="ignore"))))


def _upsert_population_rows(tenant_db: Session, tid: int, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    from .sso_router import _make_unloginable_hash

    def _b(v):
        if v is None or str(v).strip() == "":
            return None
        return str(v).strip().lower() in ("1", "true", "yes", "y")

    def _d(v):
        v = (v or "").strip()
        try:
            return date.fromisoformat(v) if v else None
        except Exception:
            return None

    def _dt(v):
        v = (v or "").strip()
        if not v:
            return None
        try:
            return datetime.fromisoformat(v)
        except Exception:
            d = _d(v)
            return datetime.combine(d, datetime.min.time()) if d else None

    created = updated = 0
    errors: List[str] = []
    for idx, row in enumerate(rows, start=2):
        email = (str(row.get("email") or "")).strip().lower()
        if not email:
            errors.append(f"row {idx}: missing email")
            continue
        u = tenant_db.query(GRCUser).filter(GRCUser.email == email).first()
        if not u:
            u = GRCUser(username=email, email=email, password_hash=_make_unloginable_hash(), is_active=True)
            tenant_db.add(u)
            tenant_db.flush()
            created += 1
        else:
            updated += 1
        if row.get("display_name"):
            u.display_name = str(row["display_name"]).strip()
        if row.get("department"):
            u.department = str(row["department"]).strip()
        if row.get("designation"):
            u.designation = str(row["designation"]).strip()
        mfa = _b(row.get("mfa_enabled"))
        if mfa is not None:
            u.mfa_enabled = mfa
        acct = _b(row.get("account_enabled"))
        u.account_enabled = acct if acct is not None else True
        term = _d(row.get("termination_date"))
        if term:
            u.termination_date = term
        si = _dt(row.get("last_sign_in"))
        if si:
            u.entra_last_sign_in = si
        u.access_synced_at = datetime.utcnow()
        tenant_db.flush()
        roles_raw = str(row.get("roles") or "")
        sep = ";" if ";" in roles_raw else ","
        for rn in [r.strip() for r in roles_raw.split(sep) if r.strip()]:
            role = _get_or_create_role(tenant_db, tid, rn)
            _assign_role(tenant_db, tid, u.id, role.id)
    tenant_db.commit()
    return {"created": created, "updated": updated, "errors": errors[:20],
            "total_users": tenant_db.query(GRCUser).count()}


@router.post("/connectors/spreadsheet/import")
async def import_spreadsheet(
    file: UploadFile = File(...),
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Import the population from an Excel (.xlsx) or CSV file. Columns:
    email*, display_name, department, designation, mfa_enabled, account_enabled,
    termination_date, last_sign_in, roles (';'-separated)."""
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    raw = await file.read()
    try:
        rows = _rows_from_upload(file.filename, raw)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read the file: {str(e)[:140]}")
    if not rows:
        raise HTTPException(status_code=400, detail="No rows found (need a header row + data).")
    return _upsert_population_rows(tenant_db, tid, rows)


# ---------------------------------------------------------------------------
# Identity connectors — the population can come from Entra, Okta, or Test Data.
# Same "two faucets, one tank" pattern; all fill grc_users. Before /{campaign_id}.
# ---------------------------------------------------------------------------

class OktaSyncIn(BaseModel):
    domain: str
    token: str
    allowed_domains: Optional[List[str]] = None


class GoogleSyncIn(BaseModel):
    access_token: str
    customer: Optional[str] = "my_customer"
    allowed_domains: Optional[List[str]] = None


class LdapSyncIn(BaseModel):
    server: str
    base_dn: str
    bind_dn: str
    bind_password: str
    use_ssl: Optional[bool] = False
    user_filter: Optional[str] = None


class SailpointSyncIn(BaseModel):
    base_url: str
    client_id: str
    client_secret: str


class IgaSyncIn(BaseModel):
    vendor: str
    base_url: Optional[str] = ""
    credentials: Optional[Dict[str, str]] = None
    sample: Optional[bool] = False


class AppSyncIn(BaseModel):
    app: str
    base_url: Optional[str] = ""
    credentials: Optional[Dict[str, str]] = None
    sample: Optional[bool] = False


@router.get("/connectors")
def list_connectors(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    entra = _get_config(tenant_db)
    def _row(provider):
        return (
            tenant_db.query(IdentityProviderConfig)
            .filter(IdentityProviderConfig.tenant_id == tid, IdentityProviderConfig.provider == provider)
            .first()
        )
    okta, google, ldap, sp = _row("okta"), _row("google"), _row("ldap"), _row("sailpoint")
    iga, app = _row("iga"), _row("app")
    return {
        "user_count": tenant_db.query(GRCUser).count(),
        "entra": {
            "connected": bool(entra and entra.entra_directory_id),
            "directory_id": entra.entra_directory_id if entra else None,
        },
        "okta": {
            "connected": bool(okta and okta.okta_domain),
            "domain": okta.okta_domain if okta else None,
            "last_synced": okta.last_tested_at.isoformat() if okta and okta.last_tested_at else None,
        },
        "google": {
            "connected": bool(google and google.is_enabled),
            "last_synced": google.last_tested_at.isoformat() if google and google.last_tested_at else None,
        },
        "ldap": {
            "connected": bool(ldap and ldap.ldap_server),
            "server": ldap.ldap_server if ldap else None,
            "base_dn": ldap.ldap_base_dn if ldap else None,
            "last_synced": ldap.last_tested_at.isoformat() if ldap and ldap.last_tested_at else None,
        },
        "sailpoint": {
            "connected": bool(sp and sp.iga_base_url),
            "base_url": sp.iga_base_url if sp else None,
            "last_synced": sp.last_tested_at.isoformat() if sp and sp.last_tested_at else None,
        },
        "iga": {
            "connected": bool(iga and iga.iga_base_url),
            "vendor": iga.iga_vendor if iga else None,
            "base_url": iga.iga_base_url if iga else None,
            "last_synced": iga.last_tested_at.isoformat() if iga and iga.last_tested_at else None,
        },
        "apps": {
            "connected": bool(app and app.iga_vendor),
            "app": app.iga_vendor if app else None,
            "base_url": app.iga_base_url if app else None,
            "last_synced": app.last_tested_at.isoformat() if app and app.last_tested_at else None,
        },
    }


@router.post("/connectors/okta/sync")
def okta_sync(
    payload: OktaSyncIn,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Connect/refresh Okta and pull its users into grc_users. The API token is
    used for this call only and is NOT stored (only the domain + status are)."""
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    try:
        result = okta_mod.sync_okta_population(
            tenant_db, domain=payload.domain, token=payload.token,
            allowed_domains=payload.allowed_domains,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Okta sync failed: {str(e)[:180]}")

    cfg = (
        tenant_db.query(IdentityProviderConfig)
        .filter(IdentityProviderConfig.tenant_id == tid, IdentityProviderConfig.provider == "okta")
        .first()
    )
    if not cfg:
        cfg = IdentityProviderConfig(tenant_id=tid, provider="okta", created_by_id=admin.id)
        tenant_db.add(cfg)
    cfg.okta_domain = okta_mod.normalize_domain(payload.domain)
    cfg.is_enabled = True
    cfg.connected_at = cfg.connected_at or datetime.utcnow()
    cfg.connected_by_id = admin.id
    cfg.last_tested_at = datetime.utcnow()
    cfg.last_test_status = "ok"
    cfg.last_test_message = f"Synced {result['created'] + result['updated']} users"
    tenant_db.commit()
    return {**result, "domain": cfg.okta_domain}


@router.post("/connectors/google/sync")
def google_sync(
    payload: GoogleSyncIn,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Connect/refresh Google Workspace and pull its users into grc_users. The
    access token is used for this call only and is NOT stored."""
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    try:
        result = google_mod.sync_google_population(
            tenant_db, access_token=payload.access_token,
            customer=payload.customer or "my_customer", allowed_domains=payload.allowed_domains,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Google sync failed: {str(e)[:180]}")

    cfg = (
        tenant_db.query(IdentityProviderConfig)
        .filter(IdentityProviderConfig.tenant_id == tid, IdentityProviderConfig.provider == "google")
        .first()
    )
    if not cfg:
        cfg = IdentityProviderConfig(tenant_id=tid, provider="google", created_by_id=admin.id)
        tenant_db.add(cfg)
    cfg.is_enabled = True
    cfg.connected_at = cfg.connected_at or datetime.utcnow()
    cfg.connected_by_id = admin.id
    cfg.last_tested_at = datetime.utcnow()
    cfg.last_test_status = "ok"
    cfg.last_test_message = f"Synced {result['created'] + result['updated']} users"
    tenant_db.commit()
    return result


@router.post("/connectors/ldap/sync")
def ldap_sync(
    payload: LdapSyncIn,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Connect/refresh an on-prem AD/LDAP directory and pull its users into
    grc_users. The bind password is used for this call only and is NOT stored
    (only the server URL + base DN + status are)."""
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    try:
        result = ldap_mod.sync_ldap_population(
            tenant_db, server=payload.server, base_dn=payload.base_dn,
            bind_dn=payload.bind_dn, bind_password=payload.bind_password,
            use_ssl=bool(payload.use_ssl), user_filter=payload.user_filter,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:  # ldap3 not installed
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"LDAP sync failed: {str(e)[:180]}")

    cfg = (
        tenant_db.query(IdentityProviderConfig)
        .filter(IdentityProviderConfig.tenant_id == tid, IdentityProviderConfig.provider == "ldap")
        .first()
    )
    if not cfg:
        cfg = IdentityProviderConfig(tenant_id=tid, provider="ldap", created_by_id=admin.id)
        tenant_db.add(cfg)
    cfg.ldap_server = ldap_mod.normalize_server(payload.server, bool(payload.use_ssl))
    cfg.ldap_base_dn = payload.base_dn
    cfg.is_enabled = True
    cfg.connected_at = cfg.connected_at or datetime.utcnow()
    cfg.connected_by_id = admin.id
    cfg.last_tested_at = datetime.utcnow()
    cfg.last_test_status = "ok"
    cfg.last_test_message = f"Synced {result['created'] + result['updated']} users"
    tenant_db.commit()
    return {**result, "server": cfg.ldap_server, "base_dn": cfg.ldap_base_dn}


@router.post("/connectors/sailpoint/sync")
def sailpoint_sync(
    payload: SailpointSyncIn,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Tier-2: connect/refresh a SailPoint IGA tenant and pull its identities +
    entitlements into grc_users / grc_roles. The client secret is used for this
    call only and is NOT stored (only the base URL + status are)."""
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    try:
        result = sailpoint_mod.sync_sailpoint_population(
            tenant_db, tenant_id=tid, base_url=payload.base_url,
            client_id=payload.client_id, client_secret=payload.client_secret,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"SailPoint sync failed: {str(e)[:180]}")

    cfg = (
        tenant_db.query(IdentityProviderConfig)
        .filter(IdentityProviderConfig.tenant_id == tid, IdentityProviderConfig.provider == "sailpoint")
        .first()
    )
    if not cfg:
        cfg = IdentityProviderConfig(tenant_id=tid, provider="sailpoint", created_by_id=admin.id)
        tenant_db.add(cfg)
    cfg.iga_base_url = sailpoint_mod.normalize_base_url(payload.base_url)
    cfg.iga_vendor = "sailpoint"
    cfg.is_enabled = True
    cfg.connected_at = cfg.connected_at or datetime.utcnow()
    cfg.connected_by_id = admin.id
    cfg.last_tested_at = datetime.utcnow()
    cfg.last_test_status = "ok"
    cfg.last_test_message = (f"Synced {result['created'] + result['updated']} identities, "
                             f"{result['entitlements_linked']} entitlements")
    tenant_db.commit()
    return {**result, "base_url": cfg.iga_base_url}


@router.get("/connectors/iga/vendors")
def iga_vendors(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """The Tier-2 IGA/IAM governance vendors we can connect to + the credential
    fields each one needs (so the UI renders the right form)."""
    _require_admin(tenant_db, grc_auth_token, authorization)
    return {"vendors": iga_mod.vendor_list()}


@router.post("/connectors/iga/sync")
def iga_sync(
    payload: IgaSyncIn,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Tier-2: connect/refresh any IGA/IAM governance system (SailPoint, Saviynt,
    Oracle IG, IBM, Ping, JumpCloud, CyberArk, BeyondTrust, …) and pull its
    identities + entitlements. Credentials are used for this call only and are
    NOT stored (only the vendor + base URL + status are)."""
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    if payload.vendor not in iga_mod.VENDORS:
        raise HTTPException(status_code=400, detail=f"Unknown IGA vendor '{payload.vendor}'")
    try:
        result = iga_mod.sync_iga_population(
            tenant_db, tenant_id=tid, vendor_key=payload.vendor,
            base_url=payload.base_url or "", credentials=payload.credentials or {},
            sample=bool(payload.sample),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"{payload.vendor} sync failed: {str(e)[:180]}")

    cfg = (
        tenant_db.query(IdentityProviderConfig)
        .filter(IdentityProviderConfig.tenant_id == tid, IdentityProviderConfig.provider == "iga")
        .first()
    )
    if not cfg:
        cfg = IdentityProviderConfig(tenant_id=tid, provider="iga", created_by_id=admin.id)
        tenant_db.add(cfg)
    cfg.iga_base_url = iga_mod.normalize_base_url(payload.base_url or "") or "sample-data"
    cfg.iga_vendor = payload.vendor
    cfg.is_enabled = True
    cfg.connected_at = cfg.connected_at or datetime.utcnow()
    cfg.connected_by_id = admin.id
    cfg.last_tested_at = datetime.utcnow()
    cfg.last_test_status = "ok"
    cfg.last_test_message = (f"{payload.vendor}{' (sample)' if payload.sample else ''}: synced "
                             f"{result['created'] + result['updated']} identities, "
                             f"{result['entitlements_linked']} entitlements")
    tenant_db.commit()
    return {**result, "base_url": cfg.iga_base_url}


@router.get("/connectors/apps/catalog")
def apps_catalog(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Tier-3 target business apps we can connect to + the credential fields each needs."""
    _require_admin(tenant_db, grc_auth_token, authorization)
    return {"apps": apps_mod.app_list()}


@router.post("/connectors/apps/sync")
def apps_sync(
    payload: AppSyncIn,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Tier-3: connect/refresh a target business app (Core Banking, SAP, Salesforce,
    Oracle EBS, ServiceNow, Databases) and pull its users + app-level permissions.
    Credentials are used for this call only and are NOT stored."""
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    if payload.app not in apps_mod.APPS:
        raise HTTPException(status_code=400, detail=f"Unknown app '{payload.app}'")
    try:
        result = apps_mod.sync_app_population(
            tenant_db, tenant_id=tid, app_key=payload.app,
            base_url=payload.base_url or "", credentials=payload.credentials or {},
            sample=bool(payload.sample),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"{payload.app} sync failed: {str(e)[:180]}")

    cfg = (
        tenant_db.query(IdentityProviderConfig)
        .filter(IdentityProviderConfig.tenant_id == tid, IdentityProviderConfig.provider == "app")
        .first()
    )
    if not cfg:
        cfg = IdentityProviderConfig(tenant_id=tid, provider="app", created_by_id=admin.id)
        tenant_db.add(cfg)
    cfg.iga_base_url = (apps_mod.normalize_base_url(payload.base_url or "")
                        or (payload.credentials or {}).get("host") or "sample-data")
    cfg.iga_vendor = payload.app
    cfg.is_enabled = True
    cfg.connected_at = cfg.connected_at or datetime.utcnow()
    cfg.connected_by_id = admin.id
    cfg.last_tested_at = datetime.utcnow()
    cfg.last_test_status = "ok"
    cfg.last_test_message = (f"{payload.app}{' (sample)' if payload.sample else ''}: synced "
                             f"{result['created'] + result['updated']} users, "
                             f"{result['entitlements_linked']} permissions")
    tenant_db.commit()
    return {**result, "base_url": cfg.iga_base_url}


# ---------------------------------------------------------------------------
# Rule library — the catalog-driven engine's rules (enable/disable + severity).
# Definitions live in rule_catalog.py; this table only stores tenant overrides.
# Registered before /{campaign_id} so the literal paths win.
# ---------------------------------------------------------------------------
class RuleConfigIn(BaseModel):
    enabled: Optional[bool] = None
    severity: Optional[str] = None


@router.get("/rules/catalog")
def rules_catalog(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    return rules_mod.catalog_view(tenant_db, tid)


@router.patch("/rules/{rule_id}")
def update_rule_config(
    rule_id: str,
    payload: RuleConfigIn,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Enable/disable a rule (or override its severity) for this tenant. Only
    runnable rules can be toggled — the rest need a connector first."""
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    rule = rules_mod.CATALOG_BY_ID.get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Unknown rule")
    if rule["status"] != rules_mod.RUNNABLE:
        raise HTTPException(status_code=400,
                            detail="This rule needs its connector/data before it can run.")
    if payload.severity and payload.severity not in ("low", "medium", "high", "critical"):
        raise HTTPException(status_code=400, detail="Invalid severity")
    cfg = (
        tenant_db.query(AccessReviewRuleConfig)
        .filter(AccessReviewRuleConfig.tenant_id == tid,
                AccessReviewRuleConfig.rule_id == rule_id)
        .first()
    )
    if not cfg:
        cfg = AccessReviewRuleConfig(tenant_id=tid, rule_id=rule_id,
                                     enabled=bool(rule["default_enabled"]))
        tenant_db.add(cfg)
    if payload.enabled is not None:
        cfg.enabled = payload.enabled
    if payload.severity is not None:
        cfg.severity = payload.severity or None
    tenant_db.commit()
    return {"rule_id": rule_id, "enabled": cfg.enabled, "severity": cfg.severity}


@router.get("/{campaign_id}")
def get_campaign(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)
    items = (
        tenant_db.query(AccessReviewItem)
        .filter(AccessReviewItem.campaign_id == campaign_id)
        .order_by(AccessReviewItem.id.asc())
        .all()
    )
    findings_by_item: Dict[int, List[AccessReviewFinding]] = {}
    for f in (
        tenant_db.query(AccessReviewFinding)
        .filter(AccessReviewFinding.campaign_id == campaign_id)
        .all()
    ):
        findings_by_item.setdefault(f.item_id, []).append(f)
    return {
        "campaign": _campaign_dict(c),
        "items": [_item_dict(it, findings_by_item.get(it.id, [])) for it in items],
    }


# ---------------------------------------------------------------------------
# Workflow steps
# ---------------------------------------------------------------------------

@router.post("/{campaign_id}/sync-population")
def sync_population(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)
    _assert_not_completed(c)

    # Live-refresh from Microsoft Entra ONLY if it's the connected source. Every
    # other source (Okta, Google, AD/LDAP, IGA, apps, test data) has already
    # filled grc_users via its own connector — so we just build the population
    # from grc_users. This keeps Stage 1 working for ALL sources, not just Entra.
    cfg = _get_config(tenant_db)
    result: Dict[str, Any] = {}
    if cfg and cfg.entra_directory_id:
        try:
            result = enrichment_mod.sync_population(tenant_db, cfg)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    else:
        result = {"source": "existing population"}

    population = sampling_mod.build_population(tenant_db, tid, c.review_type)
    if not population:
        raise HTTPException(status_code=400,
                            detail="No users yet — connect a source (or load test data) first.")
    c.population_size = len(population)
    if c.status == "draft":
        c.status = "population_built"
    tenant_db.commit()
    return {"sync": result, "population_size": c.population_size, "status": c.status}


@router.post("/{campaign_id}/sample")
def draw_sample(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)
    _assert_not_completed(c)

    population = sampling_mod.build_population(tenant_db, tid, c.review_type)
    if not population:
        raise HTTPException(status_code=400, detail="Population is empty — sync first")
    c.population_size = len(population)

    sample = sampling_mod.draw_sample(
        tenant_db, tid, population,
        method=c.sampling_method, size=c.requested_sample_size,
        filters=c.risk_filters or {},
    )
    priv_ids = sampling_mod.privileged_user_ids(tenant_db, tid)

    # Reset prior items/findings for an idempotent re-sample.
    tenant_db.query(AccessReviewItem).filter(
        AccessReviewItem.campaign_id == campaign_id
    ).delete(synchronize_session=False)

    for u in sample:
        term = getattr(u, "termination_date", None)
        item = AccessReviewItem(
            tenant_id=tid,
            campaign_id=campaign_id,
            user_id=u.id,
            username=u.username,
            email=u.email,
            display_name=u.display_name,
            department=u.department,
            designation=u.designation,
            roles_snapshot=_role_names_for_user(tenant_db, u.id),
            mfa_enabled=getattr(u, "mfa_enabled", None),
            account_enabled=getattr(u, "account_enabled", None)
            if getattr(u, "account_enabled", None) is not None
            else u.is_active,
            last_sign_in=getattr(u, "entra_last_sign_in", None) or u.last_login,
            is_terminated=bool(term),
            termination_date=term,
            is_privileged=u.id in priv_ids,
            # Default the tier-1 reviewer to the campaign creator so overdue
            # escalation has a starting point; can be reassigned later.
            reviewer_id=c.created_by,
            decision="pending",
        )
        tenant_db.add(item)

    c.status = "sampled"
    tenant_db.commit()
    return {"sampled": len(sample), "population_size": c.population_size, "status": c.status}


@router.post("/{campaign_id}/run-checks")
def run_checks(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)
    _assert_not_completed(c)
    items = (
        tenant_db.query(AccessReviewItem)
        .filter(AccessReviewItem.campaign_id == campaign_id)
        .all()
    )
    if not items:
        raise HTTPException(status_code=400, detail="No sample drawn yet")
    total = rules_mod.run_enabled_rules(
        tenant_db, tenant_id=tid, campaign_id=campaign_id, items=items
    )
    c.exceptions_found = total
    if c.status in ("sampled", "population_built"):
        c.status = "in_review"
    _compute_risk_and_anomaly(tenant_db, campaign_id, items)
    tenant_db.commit()
    return {"findings": total, "status": c.status}


_SEV_W = {"critical": 45, "high": 30, "medium": 15, "low": 5, "info": 3}


def _compute_risk_and_anomaly(tenant_db: Session, campaign_id: int, items: List[AccessReviewItem]) -> None:
    """Deterministic per-item risk score (0-100) from findings + a peer-group
    anomaly flag (roles a user holds that no peer in their department holds)."""
    finds = (
        tenant_db.query(AccessReviewFinding)
        .filter(AccessReviewFinding.campaign_id == campaign_id).all()
    )
    by_item: Dict[int, List[AccessReviewFinding]] = {}
    for f in finds:
        by_item.setdefault(f.item_id, []).append(f)
    for it in items:
        it.risk_score = min(100, sum(_SEV_W.get((f.severity or "").lower(), 10) for f in by_item.get(it.id, [])))

    by_dept: Dict[str, List[AccessReviewItem]] = {}
    for it in items:
        by_dept.setdefault((it.department or "").strip().lower(), []).append(it)
    for it in items:
        peers = [p for p in by_dept[(it.department or "").strip().lower()] if p.id != it.id]
        if not peers:
            it.is_anomaly = False
            it.anomaly_note = None
            continue
        peer_roles: set = set()
        for p in peers:
            peer_roles |= set(p.roles_snapshot or [])
        unique = set(it.roles_snapshot or []) - peer_roles
        if unique:
            it.is_anomaly = True
            it.anomaly_note = (
                "Holds " + ", ".join(sorted(unique))
                + f" that no peer in '{it.department or 'this department'}' has."
            )
        else:
            it.is_anomaly = False
            it.anomaly_note = None


# ---------------------------------------------------------------------------
# AI assist — LLM recommends a decision + a plain-language reason per item.
# Advisory only; the human reviewer still decides (Stage 4).
# ---------------------------------------------------------------------------
_AI_SYS = (
    "You are a security access-review assistant helping an auditor certify user access. "
    "For each user, recommend exactly one decision: 'approved' (access is fine, keep it), "
    "'revoke' (remove the access), or 'exception' (risky but possibly justified - keep and flag). "
    "Base it on the risk signals and findings. Guidance: a terminated user whose account is still "
    "active, or an account with critical/high findings and no business justification, should be "
    "'revoke'; privileged-but-plausible or medium-risk cases are 'exception'; clean / low-risk "
    "users are 'approved'. "
    'Return ONLY JSON: {"recommendations":[{"id":<int>,"recommendation":"approved|revoke|exception",'
    '"reason":"<one sentence, <=22 words, concrete>"}]}'
)


def _ai_item_brief(item: AccessReviewItem, findings: List[AccessReviewFinding]) -> Dict[str, Any]:
    return {
        "id": item.id,
        "email": item.email,
        "department": item.department,
        "roles": item.roles_snapshot or [],
        "mfa_enabled": item.mfa_enabled,
        "account_enabled": item.account_enabled,
        "last_sign_in": item.last_sign_in.isoformat() if item.last_sign_in else None,
        "terminated": item.is_terminated,
        "privileged": item.is_privileged,
        "findings": [f"{f.title} ({f.severity})" for f in findings],
    }


@router.post("/{campaign_id}/ai-recommendations")
def ai_recommendations(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Generate an LLM recommendation (approve/revoke/exception + reason) per sampled
    item, from its frozen snapshot and findings. Saved to the item as advisory guidance."""
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)
    _assert_not_completed(c)

    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="AI is not configured (no OpenAI key on the server).")

    items = (
        tenant_db.query(AccessReviewItem)
        .filter(AccessReviewItem.campaign_id == campaign_id)
        .order_by(AccessReviewItem.id.asc())
        .all()
    )
    if not items:
        raise HTTPException(status_code=400, detail="No sample drawn yet")
    finds_by_item: Dict[int, List[AccessReviewFinding]] = {}
    for f in (
        tenant_db.query(AccessReviewFinding)
        .filter(AccessReviewFinding.campaign_id == campaign_id).all()
    ):
        finds_by_item.setdefault(f.item_id, []).append(f)

    import json
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    valid = {"approved", "revoke", "exception"}
    recs: Dict[int, Dict[str, str]] = {}

    # Chunk so large samples stay within a comfortable token budget.
    CHUNK = 25
    for i in range(0, len(items), CHUNK):
        batch = items[i:i + CHUNK]
        briefs = [_ai_item_brief(it, finds_by_item.get(it.id, [])) for it in batch]
        try:
            resp = client.chat.completions.create(
                model=model,
                temperature=0.2,
                max_tokens=1400,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _AI_SYS},
                    {"role": "user", "content": json.dumps({"users": briefs})},
                ],
            )
            data = json.loads(resp.choices[0].message.content or "{}")
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"AI request failed: {str(e)[:160]}")
        for r in data.get("recommendations", []):
            try:
                iid = int(r.get("id"))
            except (TypeError, ValueError):
                continue
            rec = str(r.get("recommendation", "")).strip().lower()
            if rec not in valid:
                continue
            recs[iid] = {"rec": rec, "reason": str(r.get("reason", "")).strip()[:300]}

    now = datetime.utcnow()
    applied = 0
    for it in items:
        r = recs.get(it.id)
        if not r:
            continue
        it.ai_recommendation = r["rec"]
        it.ai_reason = r["reason"]
        it.ai_recommended_at = now
        applied += 1
    tenant_db.commit()
    return {"recommended": applied, "total": len(items), "model": model}


@router.post("/{campaign_id}/ai-summary")
def ai_summary(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """LLM writes a short auditor-facing narrative of the campaign (scope,
    findings, decisions, verdict, one recommendation)."""
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="AI is not configured (no OpenAI key on the server).")

    rep = _build_report(tenant_db, c, campaign_id)
    coverage = round(rep["sample_size"] / rep["population_size"] * 100) if rep["population_size"] else 0
    ctx = {
        "name": c.name, "review_type": c.review_type, "status": c.status,
        "population": rep["population_size"], "sample_size": rep["sample_size"],
        "coverage_pct": coverage, "users_with_open_exceptions": rep["users_with_exceptions"],
        "exceptions_total": rep["exceptions_total"], "exceptions_open": rep.get("exceptions_open"),
        "findings_by_type": rep["findings_by_type"], "findings_by_severity": rep["findings_by_severity"],
        "decisions": rep["decisions"], "verdict": rep["verdict"],
    }
    import json
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    sys = (
        "You write a concise, factual access-review summary for an auditor. "
        "4-6 sentences, plain English, no markdown or bullet points. Cover: the scope and "
        "coverage; what the automated checks found (notable types/severities); what reviewers "
        "decided; the verdict and what it means; and end with one concrete recommendation. "
        "Use only the numbers given."
    )
    try:
        resp = client.chat.completions.create(
            model=model, temperature=0.3, max_tokens=400,
            messages=[{"role": "system", "content": sys},
                      {"role": "user", "content": json.dumps(ctx)}],
        )
        summary = (resp.choices[0].message.content or "").strip()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"AI request failed: {str(e)[:160]}")
    c.ai_summary = summary
    c.ai_summary_at = datetime.utcnow()
    tenant_db.commit()
    return {"summary": summary, "model": model}


@router.post("/items/{item_id}/decision")
def set_decision(
    item_id: int,
    payload: DecisionIn,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    item = (
        tenant_db.query(AccessReviewItem)
        .filter(AccessReviewItem.id == item_id, AccessReviewItem.tenant_id == tid)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    _assert_not_completed(_campaign_or_404(tenant_db, item.campaign_id, tid))
    if payload.decision not in ("approved", "revoke", "exception", "pending"):
        raise HTTPException(status_code=400, detail="Invalid decision")
    item.decision = payload.decision
    item.decision_comment = payload.comment
    item.decision_by = admin.id
    item.decision_at = datetime.utcnow()
    tenant_db.commit()
    return {"id": item.id, "decision": item.decision}


@router.post("/{campaign_id}/close")
def close_campaign(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)
    items = (
        tenant_db.query(AccessReviewItem)
        .filter(AccessReviewItem.campaign_id == campaign_id)
        .all()
    )
    reviewed = sum(1 for it in items if it.decision != "pending")
    c.items_reviewed = reviewed
    c.exceptions_found = (
        tenant_db.query(AccessReviewFinding)
        .filter(AccessReviewFinding.campaign_id == campaign_id)
        .count()
    )
    c.status = "completed"
    c.closed_at = datetime.utcnow()
    tenant_db.commit()
    return _campaign_dict(c)


def _build_report(tenant_db: Session, c: AccessReviewCampaign, campaign_id: int) -> Dict[str, Any]:
    items = (
        tenant_db.query(AccessReviewItem)
        .filter(AccessReviewItem.campaign_id == campaign_id)
        .all()
    )
    findings = (
        tenant_db.query(AccessReviewFinding)
        .filter(AccessReviewFinding.campaign_id == campaign_id)
        .all()
    )
    by_type: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    for f in findings:
        by_type[f.finding_type] = by_type.get(f.finding_type, 0) + 1
        by_severity[f.severity] = by_severity.get(f.severity, 0) + 1
    decisions: Dict[str, int] = {}
    for it in items:
        decisions[it.decision] = decisions.get(it.decision, 0) + 1

    sample_size = len(items)
    # Only OPEN findings count against the verdict — once a finding is triaged
    # (remediated / accepted_risk / false_positive) it is considered handled,
    # so working findings down actually improves the result.
    open_findings = [f for f in findings if (f.status or "open") == "open"]
    users_with_exceptions = len({f.item_id for f in open_findings})
    verdict = "effective" if users_with_exceptions == 0 else (
        "deficient" if users_with_exceptions <= max(1, sample_size // 10) else "material_weakness"
    )
    return {
        "campaign": _campaign_dict(c),
        "population_size": c.population_size,
        "sample_size": sample_size,
        "exceptions_total": len(findings),
        "exceptions_open": len(open_findings),
        "users_with_exceptions": users_with_exceptions,
        "findings_by_type": by_type,
        "findings_by_severity": by_severity,
        "decisions": decisions,
        "verdict": verdict,
        "ai_summary": c.ai_summary,
    }


@router.get("/{campaign_id}/report")
def report(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)
    return _build_report(tenant_db, c, campaign_id)


# ---------------------------------------------------------------------------
# Per-item evidence (upload + download)
# ---------------------------------------------------------------------------

@router.post("/items/{item_id}/evidence")
async def upload_item_evidence(
    item_id: int,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    item = (
        tenant_db.query(AccessReviewItem)
        .filter(AccessReviewItem.id == item_id, AccessReviewItem.tenant_id == tid)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    tenant_dir = os.path.join(_EVIDENCE_DIR, str(tid))
    os.makedirs(tenant_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1]
    disk_path = os.path.join(tenant_dir, f"{uuid.uuid4().hex}{ext}")
    contents = await file.read()
    with open(disk_path, "wb") as fh:
        fh.write(contents)

    ev = Evidence(
        tenant_id=tid,
        name=name or (file.filename or f"access-review-item-{item_id}"),
        file_path=disk_path,
        file_name=file.filename,
        file_type=file.content_type,
        uploaded_by=admin.id,
        status="draft",
    )
    tenant_db.add(ev)
    tenant_db.flush()
    item.evidence_id = ev.id
    tenant_db.commit()
    return {"item_id": item.id, "evidence_id": ev.id, "file_name": ev.file_name}


@router.get("/items/{item_id}/evidence")
def download_item_evidence(
    item_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    item = (
        tenant_db.query(AccessReviewItem)
        .filter(AccessReviewItem.id == item_id, AccessReviewItem.tenant_id == tid)
        .first()
    )
    if not item or not item.evidence_id:
        raise HTTPException(status_code=404, detail="No evidence attached")
    ev = tenant_db.query(Evidence).filter(Evidence.id == item.evidence_id).first()
    if not ev or not ev.file_path or not os.path.exists(ev.file_path):
        raise HTTPException(status_code=404, detail="Evidence file missing")
    return FileResponse(
        ev.file_path,
        media_type=ev.file_type or "application/octet-stream",
        filename=ev.file_name or os.path.basename(ev.file_path),
    )


# ---------------------------------------------------------------------------
# Escalation chain + overdue escalation
# ---------------------------------------------------------------------------

@router.get("/{campaign_id}/escalation-chain")
def list_escalation_chain(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    _campaign_or_404(tenant_db, campaign_id, tid)
    rows = (
        tenant_db.query(AccessReviewEscalation)
        .filter(AccessReviewEscalation.campaign_id == campaign_id)
        .order_by(AccessReviewEscalation.tier.asc())
        .all()
    )
    return {
        "tiers": [
            {
                "id": r.id, "tier": r.tier, "tier_name": r.tier_name,
                "approver_id": r.approver_id,
                "escalation_delay_days": r.escalation_delay_days,
            }
            for r in rows
        ]
    }


class EscalationTierIn(BaseModel):
    tier: int
    tier_name: Optional[str] = None
    approver_id: Optional[int] = None
    escalation_delay_days: int = 3


@router.post("/{campaign_id}/escalation-chain")
def add_escalation_tier(
    campaign_id: int,
    payload: EscalationTierIn,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    _campaign_or_404(tenant_db, campaign_id, tid)
    existing = (
        tenant_db.query(AccessReviewEscalation)
        .filter(
            AccessReviewEscalation.campaign_id == campaign_id,
            AccessReviewEscalation.tier == payload.tier,
        )
        .first()
    )
    if existing:
        existing.tier_name = payload.tier_name
        existing.approver_id = payload.approver_id
        existing.escalation_delay_days = payload.escalation_delay_days
        tenant_db.commit()
        return {"id": existing.id, "tier": existing.tier, "updated": True}
    row = AccessReviewEscalation(
        tenant_id=tid,
        campaign_id=campaign_id,
        tier=payload.tier,
        tier_name=payload.tier_name,
        approver_id=payload.approver_id,
        escalation_delay_days=payload.escalation_delay_days,
    )
    tenant_db.add(row)
    tenant_db.commit()
    return {"id": row.id, "tier": row.tier, "updated": False}


@router.post("/{campaign_id}/escalate-overdue")
def escalate_overdue(
    campaign_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Bump every still-pending item past the campaign due date to the next
    escalation tier and record that tier's approver as escalated_to."""
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)
    _assert_not_completed(c)
    if not c.escalation_enabled:
        raise HTTPException(status_code=400, detail="Escalation is disabled for this campaign")
    if not c.due_date:
        raise HTTPException(status_code=400, detail="Campaign has no due date")
    now = datetime.utcnow()
    if c.due_date >= now:
        return {"escalated": 0, "reason": "not past due date yet"}

    tiers = {
        t.tier: t
        for t in tenant_db.query(AccessReviewEscalation)
        .filter(AccessReviewEscalation.campaign_id == campaign_id)
        .all()
    }
    if not tiers:
        raise HTTPException(status_code=400, detail="No escalation tiers configured")

    pending = (
        tenant_db.query(AccessReviewItem)
        .filter(
            AccessReviewItem.campaign_id == campaign_id,
            AccessReviewItem.decision == "pending",
        )
        .all()
    )
    escalated = 0
    for item in pending:
        next_tier = (item.escalation_tier or 1) + 1
        chain = tiers.get(next_tier)
        if not chain:
            continue
        item.escalation_tier = next_tier
        item.escalated_to_id = chain.approver_id
        item.escalation_sent_at = now
        escalated += 1
    tenant_db.commit()
    return {"escalated": escalated, "pending_total": len(pending)}


# ---------------------------------------------------------------------------
# Report export (CSV / XLSX / PDF)
# ---------------------------------------------------------------------------

@router.get("/{campaign_id}/report/export")
def export_report(
    campaign_id: int,
    format: str = "csv",
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    c = _campaign_or_404(tenant_db, campaign_id, tid)

    items = (
        tenant_db.query(AccessReviewItem)
        .filter(AccessReviewItem.campaign_id == campaign_id)
        .order_by(AccessReviewItem.id.asc())
        .all()
    )
    findings_by_item: Dict[int, List[AccessReviewFinding]] = {}
    for f in (
        tenant_db.query(AccessReviewFinding)
        .filter(AccessReviewFinding.campaign_id == campaign_id)
        .all()
    ):
        findings_by_item.setdefault(f.item_id, []).append(f)
    item_dicts = [_item_dict(it, findings_by_item.get(it.id, [])) for it in items]

    stem = f"access_review_{campaign_id}"
    fmt = (format or "csv").lower()
    if fmt == "xlsx":
        return export_mod.xlsx_response(stem, item_dicts)
    if fmt == "pdf":
        report_data = _build_report(tenant_db, c, campaign_id)
        return export_mod.pdf_response(stem, _campaign_dict(c), report_data, item_dicts)
    return export_mod.csv_response(stem, item_dicts)


# ---------------------------------------------------------------------------
# SoD rules
# ---------------------------------------------------------------------------

@router.get("/sod/rules")
def list_sod_rules(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    rows = tenant_db.query(SoDRule).filter(SoDRule.tenant_id == tid).all()
    names = {r.id: r.name for r in tenant_db.query(Role).all()}
    return {
        "rules": [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "role_a_id": r.role_a_id,
                "role_a_name": names.get(r.role_a_id),
                "role_b_id": r.role_b_id,
                "role_b_name": names.get(r.role_b_id),
                "severity": r.severity,
                "is_active": r.is_active,
            }
            for r in rows
        ]
    }


@router.post("/sod/rules")
def create_sod_rule(
    payload: SoDRuleCreate,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    admin = _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    if payload.role_a_id == payload.role_b_id:
        raise HTTPException(status_code=400, detail="A SoD rule needs two different roles")
    if not payload.name or not payload.name.strip():
        raise HTTPException(status_code=400, detail="Rule name is required")
    # One rule per role pair — and the pair is the same in either order.
    a, b = payload.role_a_id, payload.role_b_id
    existing = (
        tenant_db.query(SoDRule)
        .filter(
            SoDRule.tenant_id == tid,
            ((SoDRule.role_a_id == a) & (SoDRule.role_b_id == b))
            | ((SoDRule.role_a_id == b) & (SoDRule.role_b_id == a)),
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"A rule for these two roles already exists: \"{existing.name}\". Delete it first to replace it.",
        )
    rule = SoDRule(
        tenant_id=tid,
        name=payload.name.strip(),
        description=payload.description,
        role_a_id=payload.role_a_id,
        role_b_id=payload.role_b_id,
        severity=payload.severity,
        created_by=admin.id,
    )
    tenant_db.add(rule)
    try:
        tenant_db.commit()
    except Exception:
        tenant_db.rollback()
        raise HTTPException(status_code=400, detail="Could not add rule — a rule for these roles already exists.")
    return {"id": rule.id}


@router.delete("/sod/rules/{rule_id}")
def delete_sod_rule(
    rule_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    rule = (
        tenant_db.query(SoDRule)
        .filter(SoDRule.id == rule_id, SoDRule.tenant_id == tid)
        .first()
    )
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    tenant_db.delete(rule)
    tenant_db.commit()
    return {"deleted": rule_id}


@router.patch("/findings/{finding_id}")
def update_finding(
    finding_id: int,
    payload: FindingUpdate,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    tid = _tenant_id(tenant_db)
    f = (
        tenant_db.query(AccessReviewFinding)
        .filter(AccessReviewFinding.id == finding_id, AccessReviewFinding.tenant_id == tid)
        .first()
    )
    if not f:
        raise HTTPException(status_code=404, detail="Finding not found")
    if payload.status not in ("open", "remediated", "accepted_risk", "false_positive"):
        raise HTTPException(status_code=400, detail="Invalid status")
    f.status = payload.status
    f.remediation_note = payload.remediation_note
    tenant_db.commit()
    return {"id": f.id, "status": f.status}
