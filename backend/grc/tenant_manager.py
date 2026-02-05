import os
import re
from datetime import datetime
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker, Session
from typing import Optional, Dict, Any, List
from contextlib import contextmanager

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/grc_db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

master_engine = create_engine(DATABASE_URL)
MasterSession = sessionmaker(autocommit=False, autoflush=False, bind=master_engine)

tenant_engines: Dict[str, Any] = {}
tenant_sessions: Dict[str, sessionmaker] = {}


def sanitize_schema_name(subdomain: str) -> str:
    schema = re.sub(r'[^a-z0-9_]', '_', subdomain.lower())
    if schema[0].isdigit():
        schema = f"t_{schema}"
    return f"tenant_{schema}"


def get_tenant_engine(schema_name: str):
    if schema_name not in tenant_engines:
        engine = create_engine(
            DATABASE_URL,
            connect_args={"options": f"-csearch_path={schema_name},public"}
        )
        tenant_engines[schema_name] = engine
        tenant_sessions[schema_name] = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return tenant_engines[schema_name]


def get_tenant_session(schema_name: str) -> sessionmaker:
    if schema_name not in tenant_sessions:
        get_tenant_engine(schema_name)
    return tenant_sessions[schema_name]


@contextmanager
def tenant_session(schema_name: str):
    SessionClass = get_tenant_session(schema_name)
    session = SessionClass()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def create_tenant_schema(subdomain: str) -> str:
    schema_name = sanitize_schema_name(subdomain)
    
    with master_engine.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}"'))
        conn.commit()
    
    return schema_name


def initialize_tenant_tables(schema_name: str):
    from .tenant_models import TenantBase
    
    engine = get_tenant_engine(schema_name)
    
    with engine.connect() as conn:
        conn.execute(text(f'SET search_path TO "{schema_name}"'))
        conn.commit()
    
    TenantBase.metadata.create_all(bind=engine)


def drop_tenant_schema(schema_name: str):
    with master_engine.connect() as conn:
        conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
        conn.commit()
    
    if schema_name in tenant_engines:
        tenant_engines[schema_name].dispose()
        del tenant_engines[schema_name]
    if schema_name in tenant_sessions:
        del tenant_sessions[schema_name]


def provision_tenant(subdomain: str) -> str:
    schema_name = create_tenant_schema(subdomain)
    initialize_tenant_tables(schema_name)
    return schema_name


def seed_tenant_permissions(schema_name: str):
    from .permissions import PERMISSION_MATRIX
    from .tenant_models import Permission
    
    SessionClass = get_tenant_session(schema_name)
    session = SessionClass()
    try:
        existing = session.query(Permission).count()
        if existing > 0:
            session.close()
            return
        
        for module_data in PERMISSION_MATRIX:
            module = module_data["module"]
            for submodule_data in module_data.get("submodules", []):
                submodule = submodule_data["name"]
                for action in submodule_data.get("actions", []):
                    perm_name = f"{module}:{submodule}:{action}"
                    perm = Permission(
                        name=perm_name,
                        module=module,
                        submodule=submodule,
                        action=action,
                        description=f"{action.replace('_', ' ').title()} {submodule.replace('_', ' ')}"
                    )
                    session.add(perm)
        session.commit()
    finally:
        session.close()


def seed_tenant_admin_role(schema_name: str, admin_user_id: int):
    from .tenant_models import Role, RolePermission, Permission, UserRole
    
    SessionClass = get_tenant_session(schema_name)
    session = SessionClass()
    try:
        admin_role = session.query(Role).filter(Role.name == "Administrator").first()
        if not admin_role:
            admin_role = Role(
                name="Administrator",
                description="Full administrative access to all modules and features",
                is_system_role=True
            )
            session.add(admin_role)
            session.flush()
        
        all_perms = session.query(Permission).all()
        for perm in all_perms:
            existing = session.query(RolePermission).filter(
                RolePermission.role_id == admin_role.id,
                RolePermission.permission_id == perm.id
            ).first()
            if not existing:
                rp = RolePermission(role_id=admin_role.id, permission_id=perm.id)
                session.add(rp)
        
        user_role = UserRole(
            user_id=admin_user_id,
            role_id=admin_role.id
        )
        session.add(user_role)
        session.commit()
    finally:
        session.close()


def create_tenant_admin_user(schema_name: str, username: str, email: str, password_hash: str, display_name: str) -> int:
    from .tenant_models import TenantUser as TenantSchemaUser
    import bcrypt
    
    SessionClass = get_tenant_session(schema_name)
    session = SessionClass()
    try:
        admin_user = TenantSchemaUser(
            username=username,
            email=email,
            password_hash=password_hash,
            display_name=display_name,
            is_active=True
        )
        session.add(admin_user)
        session.commit()
        session.refresh(admin_user)
        return admin_user.id
    finally:
        session.close()


def create_organization_profile(schema_name: str, name: str, legal_entity: str = None, 
                                 industry: str = None, company_size: str = None,
                                 geography: str = None, regulatory_scope: str = None,
                                 contact_name: str = None, contact_email: str = None,
                                 contact_phone: str = None):
    from .tenant_models import OrganizationProfile
    
    SessionClass = get_tenant_session(schema_name)
    session = SessionClass()
    try:
        profile = OrganizationProfile(
            name=name,
            legal_entity=legal_entity,
            industry=industry,
            company_size=company_size,
            geography=geography,
            regulatory_scope=regulatory_scope,
            primary_contact_name=contact_name,
            primary_contact_email=contact_email,
            primary_contact_phone=contact_phone
        )
        session.add(profile)
        session.commit()
        session.refresh(profile)
        return profile.id
    finally:
        session.close()


def full_tenant_provisioning(subdomain: str, org_name: str, admin_username: str, 
                              admin_email: str, admin_password_hash: str, 
                              admin_display_name: str, org_details: dict = None) -> dict:
    schema_name = provision_tenant(subdomain)
    
    seed_tenant_permissions(schema_name)
    
    admin_user_id = create_tenant_admin_user(
        schema_name=schema_name,
        username=admin_username,
        email=admin_email,
        password_hash=admin_password_hash,
        display_name=admin_display_name
    )
    
    seed_tenant_admin_role(schema_name, admin_user_id)
    
    org_details = org_details or {}
    create_organization_profile(
        schema_name=schema_name,
        name=org_name,
        legal_entity=org_details.get('legal_entity'),
        industry=org_details.get('industry'),
        company_size=org_details.get('company_size'),
        geography=org_details.get('geography'),
        regulatory_scope=org_details.get('regulatory_scope'),
        contact_name=admin_display_name,
        contact_email=admin_email,
        contact_phone=org_details.get('contact_phone')
    )
    
    return {
        "schema_name": schema_name,
        "admin_user_id": admin_user_id
    }


def get_master_db():
    db = MasterSession()
    try:
        yield db
    finally:
        db.close()
