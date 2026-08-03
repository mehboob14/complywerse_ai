from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
from typing import Optional
import re

from ..models import Tenant, SessionLocal


def extract_subdomain(host: str) -> Optional[str]:
    if not host:
        return None
    
    host = host.split(':')[0].lower()
    
    if host in ['localhost', '127.0.0.1']:
        return None
    
    if re.match(r'^\d+\.\d+\.\d+\.\d+$', host):
        return None
    
    parts = host.split('.')
    
    if len(parts) >= 3:
        subdomain = parts[0]
        if subdomain not in ['www', 'api', 'app']:
            return subdomain
    
    return None


def get_tenant_by_subdomain(subdomain: str, db: Session) -> Optional[Tenant]:
    return db.query(Tenant).filter(
        Tenant.subdomain == subdomain,
        Tenant.is_active == True
    ).first()


def get_tenant_by_slug(slug: str, db: Session) -> Optional[Tenant]:
    return db.query(Tenant).filter(
        Tenant.slug == slug,
        Tenant.is_active == True
    ).first()


class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        host = request.headers.get("host", "")
        subdomain = extract_subdomain(host)
        
        request.state.subdomain = subdomain
        request.state.tenant = None
        request.state.schema_name = None
        
        if subdomain:
            db = SessionLocal()
            try:
                tenant = get_tenant_by_subdomain(subdomain, db)
                if tenant:
                    request.state.tenant = tenant
                    request.state.schema_name = tenant.schema_name
            finally:
                db.close()
        
        x_tenant_slug = request.headers.get("X-Tenant-Slug")
        if x_tenant_slug and not request.state.tenant:
            db = SessionLocal()
            try:
                tenant = get_tenant_by_slug(x_tenant_slug, db)
                if tenant:
                    request.state.tenant = tenant
                    request.state.schema_name = tenant.schema_name
            finally:
                db.close()
        
        response = await call_next(request)
        return response


def get_current_tenant(request: Request) -> Optional[Tenant]:
    return getattr(request.state, 'tenant', None)


def get_current_schema(request: Request) -> Optional[str]:
    return getattr(request.state, 'schema_name', None)


def require_tenant(request: Request) -> Tenant:
    tenant = get_current_tenant(request)
    if not tenant:
        raise HTTPException(
            status_code=400,
            detail="Tenant not found. Please access via your organization subdomain."
        )
    return tenant
