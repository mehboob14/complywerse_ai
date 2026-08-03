from ._04_user_model_extended import *  # noqa: F401,F403

# =============================================================================
# 3b. Identity Provider Integration (Microsoft Entra ID, etc.)
# =============================================================================

class IdentityProviderConfig(Base):
    """Per-(GRC-tenant) SSO/identity-provider connection.

    SaaS multi-tenant pattern: a single Compliverse-owned Azure app
    registration (env vars ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET) is consented
    to by each customer org. The tenant connection stores only the customer's
    Microsoft directory ID (`entra_directory_id`, the `tid` claim) — that is
    what binds a GRC tenant (e.g. ubl) to a specific Microsoft Entra
    organization.

    The legacy per-tenant Azure-app columns (azure_tenant_id, client_id,
    client_secret_encrypted, redirect_uri) are kept as nullable for backwards
    compatibility with any rows written under the previous design; the new
    consent-based flow does not populate them.
    """
    __tablename__ = "grc_identity_provider_configs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    provider = Column(String(32), nullable=False)
    is_enabled = Column(Boolean, default=False, nullable=False)

    # SaaS multi-tenant: the customer's Microsoft directory `tid`
    entra_directory_id = Column(String(64), nullable=True, index=True)
    connected_at = Column(DateTime, nullable=True)
    connected_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    # Okta connector: just the org domain (the SSWS API token is NOT stored at
    # rest — it is supplied per-sync). Lives on the provider='okta' config row.
    okta_domain = Column(String(255), nullable=True)

    # On-prem AD/LDAP connector: server URL + search base. The bind password is
    # NEVER stored — it is supplied per-sync. Lives on provider='ldap' row.
    ldap_server = Column(String(255), nullable=True)
    ldap_base_dn = Column(String(500), nullable=True)

    # Tier-2 IGA governance connector (SailPoint, Saviynt, …): the API base URL +
    # vendor. The client secret is NEVER stored — supplied per-sync. Lives on the
    # provider='sailpoint' (etc.) config row.
    iga_base_url = Column(String(255), nullable=True)
    iga_vendor = Column(String(32), nullable=True)

    # LEGACY (per-tenant Azure-app pattern). New rows leave these NULL.
    azure_tenant_id = Column(String(64), nullable=True)
    client_id = Column(String(64), nullable=True)
    client_secret_encrypted = Column(LargeBinary, nullable=True)
    redirect_uri = Column(String(500), nullable=True)

    # Provisioning behaviour
    auto_provision_on_signin = Column(Boolean, default=True, nullable=False)
    allowed_email_domains = Column(JSON, default=list)

    # Connectivity status (populated by /sso/config/test)
    last_tested_at = Column(DateTime, nullable=True)
    last_test_status = Column(String(32), nullable=True)
    last_test_message = Column(Text, nullable=True)

    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", name="uq_idp_tenant_provider"),
    )


class IdentityGroupRoleMapping(Base):
    """Map an Entra security group to a GRC role.

    Applied during SSO sign-in and during admin-triggered user provisioning.
    Reconciliation only touches UserRole rows whose `source == 'sso'`, so
    manually-assigned roles (source IS NULL) are never clobbered.
    """
    __tablename__ = "grc_identity_group_role_mappings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    idp_config_id = Column(
        Integer,
        ForeignKey("grc_identity_provider_configs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entra_group_id = Column(String(64), nullable=False)
    entra_group_name = Column(String(255), nullable=True)
    role_id = Column(Integer, ForeignKey("grc_roles.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "idp_config_id", "entra_group_id", "role_id",
            name="uq_idp_group_role",
        ),
    )

