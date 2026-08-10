from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    VulnerabilityControlLink, Vulnerability, FrameworkControl,
    ControlObjective, FrameworkDomain, Framework,
    ParsedFrameworkControl, UploadedFramework, CweControlOverride,
    NormalizedControl, InternalControl, GRCUser, get_db
)
from pydantic import BaseModel, Field
from ....schemas import (
    VulnerabilityControlLinkCreate, VulnerabilityControlLinkResponse, MessageResponse
)
from ....routers.auth_router import (
    require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission,
)

# Reused by the response builder + the auto-map endpoint so the "auto" vs
# "manual" decision lives in one place.
from ..control_mapping import (
    AUTO_LINK_NOTES_PREFIX,
    SENTINEL_KEV,
    SENTINEL_VULN_MGMT,
    auto_map_compliance_controls,
    invalidate_tenant_cache,
)
from ..control_mapping.cwe_control_map import (
    CWE_TO_CONTROL_IDS,
    ALWAYS_APPLICABLE_VULN_MGMT,
    ALWAYS_APPLICABLE_ACTIVE_EXPLOITATION,
    normalise_cwe,
)

router = APIRouter(tags=["Vulnerability Control Links"])


def get_vuln_or_404(vuln_id: int, user_tenants: List[int], db: Session) -> Vulnerability:
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    if not vuln:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vulnerability not found"
        )
    return vuln


def _parse_auto_marker(notes: Optional[str]) -> tuple[str, Optional[str]]:
    """Derive `(source, auto_cwe)` from the link's notes column.

    `notes` that starts with `auto:cwe:` was written by the auto-mapper;
    anything else is treated as manual. The CWE suffix (e.g. `CWE-89`)
    is returned so the UI can show "Auto • CWE-89" chips.
    """
    if isinstance(notes, str) and notes.startswith(AUTO_LINK_NOTES_PREFIX):
        suffix = notes[len(AUTO_LINK_NOTES_PREFIX):].strip()
        # `vuln-mgmt` / `kev` markers are the always-applicable rules — no
        # specific CWE to surface in that case.
        cwe = suffix if suffix.upper().startswith("CWE-") else None
        return ("auto_cwe", cwe)
    return ("manual", None)


def _build_response(
    link: VulnerabilityControlLink,
    framework_short_codes: dict[int, str],
    parsed_metadata: dict[int, dict],
) -> VulnerabilityControlLinkResponse:
    source, auto_cwe = _parse_auto_marker(link.notes)
    short_code: Optional[str] = None
    parsed_code: Optional[str] = None
    parsed_name: Optional[str] = None
    parsed_framework_name: Optional[str] = None

    if link.framework_control_id is not None:
        short_code = framework_short_codes.get(link.framework_control_id)
    if link.parsed_framework_control_id is not None:
        meta = parsed_metadata.get(link.parsed_framework_control_id) or {}
        parsed_code = meta.get("control_code")
        parsed_name = meta.get("control_name")
        parsed_framework_name = meta.get("framework_name")
        # Use the parsed framework's short_code if there's no legacy one set.
        if not short_code:
            short_code = meta.get("framework_short_code")

    return VulnerabilityControlLinkResponse(
        id=link.id,
        vulnerability_id=link.vulnerability_id,
        framework_control_id=link.framework_control_id,
        normalized_control_id=link.normalized_control_id,
        internal_control_id=link.internal_control_id,
        parsed_framework_control_id=link.parsed_framework_control_id,
        compliance_impact=link.compliance_impact,
        notes=link.notes,
        created_at=link.created_at,
        created_by=link.created_by,
        framework_control_code=link.framework_control.code if link.framework_control else None,
        framework_control_name=link.framework_control.name if link.framework_control else None,
        normalized_control_code=link.normalized_control.code if link.normalized_control else None,
        normalized_control_name=link.normalized_control.name if link.normalized_control else None,
        internal_control_name=link.internal_control.name if link.internal_control else None,
        parsed_control_code=parsed_code,
        parsed_control_name=parsed_name,
        parsed_framework_name=parsed_framework_name,
        source=source,
        auto_cwe=auto_cwe,
        framework_short_code=short_code,
    )


def _short_codes_for_framework_controls(
    db: Session, framework_control_ids: List[int],
) -> dict[int, str]:
    """Bulk-fetch `framework_short_code` for each framework_control_id.

    One query per request rather than N — followed only when there's at
    least one legacy-framework-typed link in the result set.
    """
    if not framework_control_ids:
        return {}
    rows = (
        db.query(FrameworkControl.id, Framework.short_code)
        .join(ControlObjective, ControlObjective.id == FrameworkControl.objective_id)
        .join(FrameworkDomain, FrameworkDomain.id == ControlObjective.domain_id)
        .join(Framework, Framework.id == FrameworkDomain.framework_id)
        .filter(FrameworkControl.id.in_(framework_control_ids))
        .all()
    )
    return {fc_id: code for fc_id, code in rows}


def _parsed_metadata_for_links(
    db: Session, parsed_control_ids: List[int],
) -> dict[int, dict]:
    """Bulk-fetch parsed control + parent framework metadata in one query.

    Returns ``{pfc_id: {control_code, control_name, framework_name,
    framework_short_code}}``. Empty dict when no parsed-FK links are
    present in the result set.
    """
    if not parsed_control_ids:
        return {}
    rows = (
        db.query(
            ParsedFrameworkControl.id,
            ParsedFrameworkControl.control_id,
            ParsedFrameworkControl.original_reference,
            ParsedFrameworkControl.title,
            UploadedFramework.name.label("framework_name"),
        )
        .join(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id)
        .filter(ParsedFrameworkControl.id.in_(parsed_control_ids))
        .all()
    )
    out: dict[int, dict] = {}
    for pfc_id, ctl_id, orig_ref, title, fw_name in rows:
        out[pfc_id] = {
            "control_code": ctl_id or orig_ref,
            "control_name": title,
            "framework_name": fw_name,
            "framework_short_code": _derive_short_code(fw_name),
        }
    return out


def _derive_short_code(name: Optional[str]) -> str:
    """Mirror the resolver's derivation so chips render consistently."""
    if not name:
        return ""
    return "".join(c for c in name.upper() if c.isalnum())


@router.get("/vulnerabilities/{vuln_id}/controls", response_model=List[VulnerabilityControlLinkResponse])
def list_control_links(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    get_vuln_or_404(vuln_id, user_tenants, db)

    links = db.query(VulnerabilityControlLink).options(
        joinedload(VulnerabilityControlLink.framework_control),
        joinedload(VulnerabilityControlLink.normalized_control),
        joinedload(VulnerabilityControlLink.internal_control)
    ).filter(VulnerabilityControlLink.vulnerability_id == vuln_id).all()

    fc_ids = [link.framework_control_id for link in links if link.framework_control_id is not None]
    short_codes = _short_codes_for_framework_controls(db, fc_ids)

    pfc_ids = [link.parsed_framework_control_id for link in links if link.parsed_framework_control_id is not None]
    parsed_meta = _parsed_metadata_for_links(db, pfc_ids)

    responses = [_build_response(link, short_codes, parsed_meta) for link in links]

    # CTEM Phase 2 — stamp each linked control's automated-assurance tier,
    # derived at read time from effectiveness evidence. Best-effort: a tier
    # failure must never break the links panel.
    try:
        from ....services.control_assurance import tier_for_ref
        _kind_fields = (
            ("parsed_framework_control", "parsed_framework_control_id"),
            ("internal_control", "internal_control_id"),
            ("framework_control", "framework_control_id"),
            ("normalized_control", "normalized_control_id"),
        )
        for link, resp in zip(links, responses):
            for kind, field in _kind_fields:
                ref_id = getattr(link, field, None)
                if ref_id is not None:
                    tier = tier_for_ref(db, link.vulnerability.tenant_id, kind, ref_id)
                    resp.assurance_tier = tier["tier"]
                    resp.assurance_last_tested_at = tier["last_tested_at"]
                    resp.assurance_basis = tier["basis"]
                    break
    except Exception:
        import logging
        logging.getLogger(__name__).exception("assurance tier stamp failed (non-fatal)")

    return responses


@router.post("/vulnerabilities/{vuln_id}/controls", response_model=VulnerabilityControlLinkResponse, status_code=status.HTTP_201_CREATED)
def create_control_link(
    vuln_id: int,
    request: VulnerabilityControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    get_vuln_or_404(vuln_id, user_tenants, db)

    if not any([request.framework_control_id, request.normalized_control_id, request.internal_control_id]):
        raise HTTPException(status_code=400, detail="At least one control ID must be provided")

    framework_control = None
    normalized_control = None
    internal_control = None

    if request.framework_control_id:
        framework_control = db.query(FrameworkControl).filter(
            FrameworkControl.id == request.framework_control_id
        ).first()
        if not framework_control:
            raise HTTPException(status_code=404, detail="Framework control not found")

    if request.normalized_control_id:
        normalized_control = db.query(NormalizedControl).filter(
            NormalizedControl.id == request.normalized_control_id
        ).first()
        if not normalized_control:
            raise HTTPException(status_code=404, detail="Normalized control not found")

    if request.internal_control_id:
        internal_control = db.query(InternalControl).filter(
            InternalControl.id == request.internal_control_id,
            InternalControl.tenant_id.in_(user_tenants)
        ).first()
        if not internal_control:
            raise HTTPException(status_code=404, detail="Internal control not found")

    link = VulnerabilityControlLink(
        vulnerability_id=vuln_id,
        framework_control_id=request.framework_control_id,
        normalized_control_id=request.normalized_control_id,
        internal_control_id=request.internal_control_id,
        compliance_impact=request.compliance_impact,
        notes=request.notes,
        created_by=current_user.id
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    # Resolve framework short_code + parsed metadata for the response so
    # the UI gets it without a second fetch.
    short_codes = _short_codes_for_framework_controls(
        db, [link.framework_control_id] if link.framework_control_id else []
    )
    parsed_meta = _parsed_metadata_for_links(
        db, [link.parsed_framework_control_id] if link.parsed_framework_control_id else []
    )
    # Hydrate joined relations on the just-created row.
    link = db.query(VulnerabilityControlLink).options(
        joinedload(VulnerabilityControlLink.framework_control),
        joinedload(VulnerabilityControlLink.normalized_control),
        joinedload(VulnerabilityControlLink.internal_control),
    ).filter(VulnerabilityControlLink.id == link.id).first()

    return _build_response(link, short_codes, parsed_meta)


@router.post("/vulnerabilities/{vuln_id}/controls/auto-map")
def auto_map_controls(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Re-run the CWE → framework-control auto-mapper for this vuln.

    Idempotent. Existing manual links (anything whose `notes` doesn't
    start with `auto:cwe:`) are never touched. Stale auto rows that no
    longer match the current CWE are removed; fresh ones are added.
    Returns a summary the UI surfaces in a toast.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)

    summary = auto_map_compliance_controls(
        vuln, db, delete_stale=True, user_id=current_user.id,
    )
    return summary


RESOLVED_STATUSES = {
    "resolved", "remediated", "verified", "closed",
    "accepted", "false_positive", "auto_closed_decommissioned",
    "auto_closed_fixed",
}


@router.get("/framework-controls/{control_id}/vulnerability-evidence")
def get_control_vulnerability_evidence(
    control_id: int,
    control_type: str = "parsed",  # "parsed" | "legacy" — defaults to the
                                    # upload-driven table where seeded data lives
    include_resolved: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Reverse lookup: which open vulnerabilities currently affect this
    framework control?

    Two control tables exist:
      - `parsed` (default) — `ParsedFrameworkControl`, populated by the
        upload-driven seed path (where the 27 active frameworks live).
      - `legacy` — `FrameworkControl`, populated by the older seed path
        (typically empty on upload-seeded tenants).

    The URL path takes a numeric id and a `control_type` query param so the
    same endpoint serves both surfaces.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    ctype = (control_type or "parsed").lower()
    if ctype not in ("parsed", "legacy"):
        raise HTTPException(status_code=400, detail="control_type must be 'parsed' or 'legacy'.")

    # Resolve the control header + parent framework metadata.
    if ctype == "parsed":
        pctl = (
            db.query(
                ParsedFrameworkControl.id,
                ParsedFrameworkControl.control_id,
                ParsedFrameworkControl.original_reference,
                ParsedFrameworkControl.title,
                ParsedFrameworkControl.description,
                ParsedFrameworkControl.full_text,
                UploadedFramework.id.label("ufw_id"),
                UploadedFramework.name.label("framework_name"),
                UploadedFramework.tenant_id.label("ufw_tenant_id"),
                UploadedFramework.is_shared.label("ufw_is_shared"),
            )
            .join(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id)
            .filter(ParsedFrameworkControl.id == control_id)
            .first()
        )
        if not pctl:
            raise HTTPException(status_code=404, detail="Parsed framework control not found")
        # Tenant guard — the parent uploaded framework must be visible to
        # the caller's tenants OR shared.
        if not pctl.ufw_is_shared and pctl.ufw_tenant_id not in user_tenants:
            raise HTTPException(status_code=404, detail="Parsed framework control not found")

        control_header = {
            "id": pctl.id,
            "code": pctl.control_id or pctl.original_reference,
            "name": pctl.title,
            "statement": pctl.full_text or pctl.description,
            "control_objective": pctl.description,
            "framework_short_code": _derive_short_code(pctl.framework_name),
            "framework_name": pctl.framework_name,
            "control_type": "parsed",
        }
        # Pull every link targeting this PARSED control.
        q = (
            db.query(VulnerabilityControlLink, Vulnerability)
            .join(Vulnerability, Vulnerability.id == VulnerabilityControlLink.vulnerability_id)
            .filter(
                VulnerabilityControlLink.parsed_framework_control_id == control_id,
                Vulnerability.tenant_id.in_(user_tenants),
            )
        )
    else:
        # Legacy path — same shape as before. Kept for any tenant that
        # still uses the legacy FrameworkControl chain.
        ctl_row = (
            db.query(
                FrameworkControl.id, FrameworkControl.code, FrameworkControl.name,
                FrameworkControl.statement, FrameworkControl.control_objective,
                Framework.short_code, Framework.name.label("framework_name"),
            )
            .join(ControlObjective, ControlObjective.id == FrameworkControl.objective_id)
            .join(FrameworkDomain, FrameworkDomain.id == ControlObjective.domain_id)
            .join(Framework, Framework.id == FrameworkDomain.framework_id)
            .filter(FrameworkControl.id == control_id)
            .first()
        )
        if not ctl_row:
            raise HTTPException(status_code=404, detail="Framework control not found")

        control_header = {
            "id": ctl_row.id,
            "code": ctl_row.code,
            "name": ctl_row.name,
            "statement": ctl_row.statement,
            "control_objective": ctl_row.control_objective,
            "framework_short_code": ctl_row.short_code,
            "framework_name": ctl_row.framework_name,
            "control_type": "legacy",
        }
        q = (
            db.query(VulnerabilityControlLink, Vulnerability)
            .join(Vulnerability, Vulnerability.id == VulnerabilityControlLink.vulnerability_id)
            .filter(
                VulnerabilityControlLink.framework_control_id == control_id,
                Vulnerability.tenant_id.in_(user_tenants),
            )
        )

    if not include_resolved:
        q = q.filter(~Vulnerability.status.in_(list(RESOLVED_STATUSES)))

    rows = q.all()

    by_sev = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    kev_count = 0
    max_priority = 0.0
    items = []
    for link, vuln in rows:
        sev = (vuln.severity or "info").lower()
        if sev in by_sev:
            by_sev[sev] += 1
        if bool(vuln.kev_flag):
            kev_count += 1
        if isinstance(vuln.composite_priority, (int, float)):
            max_priority = max(max_priority, float(vuln.composite_priority))
        source, auto_cwe = _parse_auto_marker(link.notes)
        items.append({
            "id": vuln.id,
            "vuln_id": vuln.vuln_id,
            "title": vuln.title,
            "cve_id": vuln.cve_id,
            "cwe_id": vuln.cwe_id,
            "severity": vuln.severity,
            "status": vuln.status,
            "kev_flag": bool(vuln.kev_flag),
            "composite_priority": vuln.composite_priority,
            "public_exploit_count": getattr(vuln, "public_exploit_count", None),
            "source": source,
            "auto_cwe": auto_cwe,
            "compliance_impact": link.compliance_impact,
            "link_id": link.id,
            "link_created_at": link.created_at,
        })

    # Sort: KEV-bearing first, then by composite priority desc, then severity.
    sev_rank = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}
    items.sort(
        key=lambda r: (
            -1 if r["kev_flag"] else 0,
            -(float(r["composite_priority"]) if isinstance(r["composite_priority"], (int, float)) else 0.0),
            -sev_rank.get((r["severity"] or "info").lower(), 0),
        )
    )

    return {
        "control": control_header,
        "summary": {
            "open_count": len(items),
            "kev_count": kev_count,
            "max_composite_priority": round(max_priority, 2),
            "by_severity": by_sev,
        },
        "items": items,
    }


@router.delete("/vulnerabilities/{vuln_id}/controls/{link_id}", response_model=MessageResponse)
def delete_control_link(
    vuln_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    get_vuln_or_404(vuln_id, user_tenants, db)

    link = db.query(VulnerabilityControlLink).filter(
        VulnerabilityControlLink.id == link_id,
        VulnerabilityControlLink.vulnerability_id == vuln_id
    ).first()

    if not link:
        raise HTTPException(status_code=404, detail="Control link not found")

    # CTEM Phase 2: evidence exists BECAUSE of the link — unlinking retracts
    # it (with per-row audit), or a pruned wrong link would keep feeding the
    # control's assurance badge forever.
    try:
        from ....services.control_assurance import retract_link_evidence
        vuln = db.query(Vulnerability).filter(Vulnerability.id == vuln_id).first()
        retract_link_evidence(
            db,
            tenant_id=vuln.tenant_id,
            vulnerability_id=vuln_id,
            control_ref={
                "framework_control_id": link.framework_control_id,
                "normalized_control_id": link.normalized_control_id,
                "internal_control_id": link.internal_control_id,
                "parsed_framework_control_id": link.parsed_framework_control_id,
            },
            actor_user_id=current_user.id,
            reason="link_removed_manually",
        )
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "evidence retraction failed for link %s (non-fatal)", link_id
        )

    db.delete(link)
    db.commit()

    return MessageResponse(message="Control link removed successfully")


# ─────────────────────────────────────────────────────────────────────────
# Tenant CWE-mapping overrides
# ─────────────────────────────────────────────────────────────────────────
# Compliance teams override the default CWE → control map per tenant:
#   - add    a custom link (e.g. CWE-89 → SAMA 4.2.1) that the default
#            map doesn't include.
#   - remove a default link they disagree with (e.g. CWE-89 → NIST SI-15).
# Sentinel CWE-IDs `__vuln_mgmt__` and `__kev__` target the always-
# applicable rule sets.


class CweOverrideCreate(BaseModel):
    cwe_id: str = Field(..., description="CWE-N, or '__vuln_mgmt__' / '__kev__'")
    framework_prefix: str = Field(..., min_length=1, max_length=100)
    control_code_pattern: str = Field(..., min_length=1, max_length=100)
    action: str = Field("add", description="'add' or 'remove'")
    notes: Optional[str] = None


class CweOverrideResponse(BaseModel):
    id: int
    tenant_id: int
    cwe_id: str
    framework_prefix: str
    control_code_pattern: str
    action: str
    notes: Optional[str] = None
    created_at: datetime
    created_by: Optional[int] = None

    class Config:
        from_attributes = True


def _validate_cwe_key(raw: str) -> str:
    """Accept `CWE-N` (normalised) or the two sentinel values."""
    s = (raw or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="cwe_id is required")
    if s in (SENTINEL_VULN_MGMT, SENTINEL_KEV):
        return s
    normalised = normalise_cwe(s)
    if not normalised:
        raise HTTPException(
            status_code=400,
            detail=f"cwe_id must be 'CWE-N', '{SENTINEL_VULN_MGMT}', or '{SENTINEL_KEV}'.",
        )
    return normalised


@router.get("/cwe-overrides", response_model=List[CweOverrideResponse])
def list_cwe_overrides(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List every CWE-override row for the caller's primary tenant."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        return []
    rows = (
        db.query(CweControlOverride)
        .filter(CweControlOverride.tenant_id == tenant_id)
        .order_by(CweControlOverride.cwe_id, CweControlOverride.framework_prefix)
        .all()
    )
    return rows


@router.post("/cwe-overrides", response_model=CweOverrideResponse, status_code=status.HTTP_201_CREATED)
def create_cwe_override(
    payload: CweOverrideCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Create one override row. Idempotent — uniqueness is enforced by the
    composite (tenant, cwe, prefix, pattern, action) constraint."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="User has no primary tenant.")
    action = (payload.action or "add").lower()
    if action not in ("add", "remove"):
        raise HTTPException(status_code=400, detail="action must be 'add' or 'remove'.")
    cwe_key = _validate_cwe_key(payload.cwe_id)

    # Reject duplicates with a clear error rather than a 500 from the
    # unique constraint.
    existing = (
        db.query(CweControlOverride)
        .filter(
            CweControlOverride.tenant_id == tenant_id,
            CweControlOverride.cwe_id == cwe_key,
            CweControlOverride.framework_prefix == payload.framework_prefix.strip(),
            CweControlOverride.control_code_pattern == payload.control_code_pattern.strip(),
            CweControlOverride.action == action,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail="An identical override already exists for this tenant.",
        )

    row = CweControlOverride(
        tenant_id=tenant_id,
        cwe_id=cwe_key,
        framework_prefix=payload.framework_prefix.strip(),
        control_code_pattern=payload.control_code_pattern.strip(),
        action=action,
        notes=(payload.notes or None),
        created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    # Drop cached resolver results so the next vuln enrichment sees this
    # override immediately.
    invalidate_tenant_cache(tenant_id)
    return row


@router.delete("/cwe-overrides/{override_id}", response_model=MessageResponse)
def delete_cwe_override(
    override_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="User has no primary tenant.")
    row = (
        db.query(CweControlOverride)
        .filter(
            CweControlOverride.id == override_id,
            CweControlOverride.tenant_id == tenant_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Override not found.")
    db.delete(row)
    db.commit()
    invalidate_tenant_cache(tenant_id)
    return MessageResponse(message="Override removed successfully")


@router.get("/cwe-overrides/preview")
def preview_cwe_resolution(
    cwe_id: Optional[str] = None,
    has_cve: bool = True,
    is_kev: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Show the effective identifier list the resolver would use for a
    given (cwe_id, has_cve, is_kev) combination after applying tenant
    overrides. Used by the UI to validate an override before saving.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        return {
            "tenant_id": None, "cwe_id": cwe_id,
            "default_identifiers": [], "effective_identifiers": [],
            "overrides_applied": [],
        }

    cwe_key = normalise_cwe(cwe_id) if cwe_id else ""

    # Default identifier list (no overrides).
    defaults: List[tuple] = []
    if cwe_key:
        defaults.extend(CWE_TO_CONTROL_IDS.get(cwe_key, []))
    if has_cve:
        defaults.extend(ALWAYS_APPLICABLE_VULN_MGMT)
    if is_kev:
        defaults.extend(ALWAYS_APPLICABLE_ACTIVE_EXPLOITATION)

    # Effective identifier list (defaults + tenant overrides applied).
    # Reuse the resolver's own helper so the preview matches reality.
    from ..control_mapping.cwe_resolver import _build_identifier_list  # noqa
    effective = _build_identifier_list(
        cwe_key, has_cve, is_kev, db=db, tenant_id=tenant_id,
    )

    # Overrides that contributed to this view.
    override_keys = []
    if cwe_key:
        override_keys.append(cwe_key)
    if has_cve:
        override_keys.append(SENTINEL_VULN_MGMT)
    if is_kev:
        override_keys.append(SENTINEL_KEV)
    overrides = (
        db.query(CweControlOverride)
        .filter(
            CweControlOverride.tenant_id == tenant_id,
            CweControlOverride.cwe_id.in_(override_keys),
        )
        .all()
        if override_keys else []
    )

    return {
        "tenant_id": tenant_id,
        "cwe_id": cwe_key or None,
        "has_cve": has_cve,
        "is_kev": is_kev,
        "default_identifiers": [{"framework_prefix": p, "control_code_pattern": c} for p, c in defaults],
        "effective_identifiers": [{"framework_prefix": p, "control_code_pattern": c} for p, c in effective],
        "overrides_applied": [
            {
                "id": o.id, "cwe_id": o.cwe_id,
                "framework_prefix": o.framework_prefix,
                "control_code_pattern": o.control_code_pattern,
                "action": o.action, "notes": o.notes,
            }
            for o in overrides
        ],
    }


# ═══ CTEM Phase 2.5 — bulk link coverage ════════════════════════════════════
# The per-vuln auto-mapper above runs one finding at a time behind a button,
# which is why link coverage sat at ~1%. These endpoints drive the SAME
# mapper (same curated crosswalk, same provenance notes, same idempotency)
# across every eligible finding, behind an explicit preview → accept flow:
# nothing is written until a human accepts, and every accepted link carries
# the auto:cwe provenance an auditor can distinguish from curated links.

def _bulk_eligible_findings(db: Session, tenant_id: int, limit: int = 5000):
    from sqlalchemy import or_
    return db.query(Vulnerability).filter(
        Vulnerability.tenant_id == tenant_id,
        or_(
            Vulnerability.cwe_id.isnot(None),
            Vulnerability.cve_id.ilike("CVE-%"),
            Vulnerability.kev_flag.is_(True),
        ),
    ).limit(limit).all()


@router.get("/control-links/bulk-automap-preview")
def bulk_automap_preview(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Dry-run: what would bulk auto-mapping create? Computed with the same
    resolver the writer uses (per-tenant cached), zero writes."""
    from ..control_mapping.cwe_resolver import resolve_cwe_to_framework_controls

    tenant_id = get_user_primary_tenant(current_user, db)
    findings = _bulk_eligible_findings(db, tenant_id)

    existing: dict[int, set] = {}
    for link in db.query(
        VulnerabilityControlLink.vulnerability_id,
        VulnerabilityControlLink.parsed_framework_control_id,
    ).join(Vulnerability, Vulnerability.id == VulnerabilityControlLink.vulnerability_id
    ).filter(Vulnerability.tenant_id == tenant_id,
             VulnerabilityControlLink.parsed_framework_control_id.isnot(None)).all():
        existing.setdefault(link[0], set()).add(link[1])

    projected_new = 0
    findings_gaining = 0
    basis = {"cwe_specific": 0, "vuln_mgmt_rule": 0, "kev_rule": 0}
    frameworks: dict[int, dict] = {}
    distinct_new_controls: set = set()
    # Controls with ANY existing link, tenant-wide — needed to split "receives
    # an additional link" from "newly evidence-eligible". Conflating the two
    # made a preview promise 48 where the coverage meter could only move 23;
    # the consent surface must state both numbers.
    linked_anywhere: set = set()
    for sets in existing.values():
        linked_anywhere |= sets

    for v in findings:
        cwe_key = normalise_cwe(v.cwe_id) if v.cwe_id else ""
        has_cve = bool(v.cve_id and v.cve_id.strip().upper().startswith("CVE-"))
        is_kev = bool(v.kev_flag)
        if cwe_key and cwe_key in CWE_TO_CONTROL_IDS:
            basis["cwe_specific"] += 1
        if has_cve:
            basis["vuln_mgmt_rule"] += 1
        if is_kev:
            basis["kev_rule"] += 1
        try:
            resolved = resolve_cwe_to_framework_controls(
                db, tenant_id=tenant_id, cwe_id=cwe_key, has_cve=has_cve, is_kev=is_kev,
            )
        except Exception:
            continue
        have = existing.get(v.id, set())
        new_here = [rc for rc in resolved if rc.parsed_control_id not in have]
        if new_here:
            findings_gaining += 1
            projected_new += len(new_here)
            for rc in new_here:
                distinct_new_controls.add(rc.parsed_control_id)
                fw = frameworks.setdefault(rc.uploaded_framework_id, {
                    "framework": getattr(rc, "framework_short_code", None)
                                 or getattr(rc, "framework_name", None)
                                 or f"framework {rc.uploaded_framework_id}",
                    "projected_links": 0, "controls": set(),
                })
                fw["projected_links"] += 1
                fw["controls"].add(rc.parsed_control_id)

    newly_eligible = distinct_new_controls - linked_anywhere
    return {
        "eligible_findings": len(findings),
        "findings_gaining_links": findings_gaining,
        "projected_new_links": projected_new,
        # Two DIFFERENT claims, both stated: how many controls receive at
        # least one new link, and how many of those had no link at all before
        # (the number the coverage meter will move by).
        "controls_receiving_links": len(distinct_new_controls),
        "controls_newly_evidence_eligible": len(newly_eligible),
        "basis_counts": basis,
        "frameworks": [
            {"framework": f["framework"], "projected_links": f["projected_links"],
             "controls": len(f["controls"])}
            for f in frameworks.values()
        ],
        "provenance_note": (
            "Accepted links are stamped auto:cwe:<basis> in notes — auditors can "
            "always distinguish accepted suggestions from manually curated links."
        ),
    }


@router.post("/control-links/bulk-automap")
def bulk_automap_accept(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    """Human-accepted bulk run of the per-vuln auto-mapper across every
    eligible finding. Idempotent (the mapper keeps/dedupes) and audited as
    one summarized event."""
    tenant_id = get_user_primary_tenant(current_user, db)
    findings = _bulk_eligible_findings(db, tenant_id)

    totals = {"findings_processed": 0, "links_added": 0, "links_kept": 0,
              "stale_removed": 0, "errors": 0}
    for v in findings:
        try:
            s = auto_map_compliance_controls(v, db, delete_stale=True, user_id=current_user.id)
            totals["findings_processed"] += 1
            totals["links_added"] += s.get("added", 0)
            totals["links_kept"] += s.get("kept", 0)
            totals["stale_removed"] += s.get("removed_stale", 0)
            if s.get("errors"):
                totals["errors"] += len(s["errors"])
        except Exception:
            totals["errors"] += 1
    db.commit()

    coverage_after = None
    try:
        from ....services.control_assurance import assurance_summary
        coverage_after = assurance_summary(db, tenant_id).get("coverage")
    except Exception:
        pass

    try:
        from ....models import AuditLog
        db.add(AuditLog(
            tenant_id=tenant_id,
            user_id=current_user.id,
            action="vulnerability.bulk_automap_accepted",
            resource_type="vulnerability_control_link",
            resource_id=0,
            changes={**totals, "coverage_after": coverage_after},
        ))
        db.commit()
    except Exception:
        db.rollback()

    return {**totals, "coverage_after": coverage_after}
