"""Shared lookup logic used by every auditor_portal section router.

The portal's path param can be either a CertificationJourney.id (preferred,
since that's what the frontend index page passes) or an UploadedFramework.id
(fallback for direct links to a framework with no active journey yet).
Centralising resolution here keeps every section endpoint consistent — they
all see the same shape and pass the same tenant guard.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ...models import (
    CertificationJourney,
    UploadedFramework,
    Framework,
)


@dataclass
class FrameworkContext:
    """Resolved framework/journey context for an auditor portal request.

    `journeys` will be empty when the path param points at an
    UploadedFramework with no certification journey started yet — the
    section endpoints should treat that as "no journey-bound data".
    """
    framework: Optional[UploadedFramework]
    published_framework: Optional[Framework]
    journeys: List[CertificationJourney]
    framework_short_code: Optional[str]
    user_tenants: List[int]

    @property
    def journey_ids(self) -> List[int]:
        return [j.id for j in self.journeys]

    @property
    def framework_label(self) -> str:
        if self.framework and self.framework.name:
            return self.framework.name
        if self.published_framework and self.published_framework.name:
            return self.published_framework.name
        if self.journeys:
            return self.journeys[0].name or "Unknown Framework"
        return "Unknown Framework"

    @property
    def framework_version(self) -> Optional[str]:
        if self.framework:
            return self.framework.version
        if self.published_framework:
            return self.published_framework.version
        return None


def resolve_framework_context(
    framework_id: int,
    user_tenants: List[int],
    db: Session,
) -> FrameworkContext:
    """Resolve a path param into a FrameworkContext.

    Tries CertificationJourney first (frontend passes journey IDs from the
    index page), then falls back to UploadedFramework, then to the
    published Framework table. Every lookup is tenant-scoped so an auditor
    user can't probe other tenants' artifacts by guessing IDs.

    Never returns 404 silently — if nothing resolves we raise so the
    section endpoints don't accidentally serve an empty payload while
    masking an authorisation failure.
    """
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenant access.",
        )

    journey = db.query(CertificationJourney).filter(
        CertificationJourney.id == framework_id,
        CertificationJourney.tenant_id.in_(user_tenants),
    ).first()

    framework: Optional[UploadedFramework] = None
    published: Optional[Framework] = None
    journeys: List[CertificationJourney] = []
    short_code: Optional[str] = None

    if journey:
        journeys = [journey]
        upload_fk = journey.uploaded_framework_id
        published_fk = journey.framework_id
        if upload_fk:
            framework = db.query(UploadedFramework).filter(
                UploadedFramework.id == upload_fk
            ).filter(
                (UploadedFramework.tenant_id.in_(user_tenants))
                | (UploadedFramework.tenant_id.is_(None))
            ).first()
        if published_fk:
            published = db.query(Framework).filter(
                Framework.id == published_fk
            ).first()
    else:
        framework = db.query(UploadedFramework).filter(
            UploadedFramework.id == framework_id
        ).filter(
            (UploadedFramework.tenant_id.in_(user_tenants))
            | (UploadedFramework.tenant_id.is_(None))
        ).first()
        if framework:
            journeys = db.query(CertificationJourney).filter(
                CertificationJourney.uploaded_framework_id == framework.id,
                CertificationJourney.tenant_id.in_(user_tenants),
            ).all()

    if not journey and not framework and not published:
        published = db.query(Framework).filter(Framework.id == framework_id).first()

    if not framework and not journey and not published:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework or journey not found in your tenant.",
        )

    # Best-effort framework short code — used by asset scope matching
    # (ITAsset.compliance_scope is a string array like ["PCI-DSS"]).
    for source in (framework, published):
        if source is not None:
            for attr in ("short_code", "code", "abbreviation"):
                value = getattr(source, attr, None)
                if isinstance(value, str) and value.strip():
                    short_code = value.strip()
                    break
            if short_code:
                break

    return FrameworkContext(
        framework=framework,
        published_framework=published,
        journeys=journeys,
        framework_short_code=short_code,
        user_tenants=user_tenants,
    )


def parsed_control_ids_for_context(ctx: FrameworkContext, db: Session) -> List[int]:
    """Return all ParsedFrameworkControl ids that belong to this framework.

    Used by transitive lookups (evidence, risks, asset links, vuln links) so
    callers can scope a query down to "controls in this framework". Returns
    [] safely when no UploadedFramework is in context.
    """
    if not ctx.framework:
        return []
    from ...models import ParsedFrameworkControl
    rows = db.query(ParsedFrameworkControl.id).filter(
        ParsedFrameworkControl.uploaded_framework_id == ctx.framework.id
    ).all()
    return [r[0] for r in rows]
