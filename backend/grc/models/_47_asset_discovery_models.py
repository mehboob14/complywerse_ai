"""Asset discovery — the persistent spine that turns one-shot network probes
into a discovery *system*.

The probing code already exists (modules/onboarding: CIDR sweep, AD enumeration).
What was missing is a place to keep what a scan finds, a record of when it ran,
and a queue a worker can drain. These five tables are that spine:

    DiscoveryCampaign   what to scan, and on what schedule
      └─ DiscoveryScope   the address ranges / OUs (and exclusions) it covers
    DiscoveryRun        one execution of a campaign
      ├─ DiscoveryJob        a durable unit of work within a run (one scope)
      └─ DiscoveryObservation   raw evidence for one thing the scan saw

DiscoveryObservation is the load-bearing one. Every scan writes observations
here first; NOTHING is turned into an asset at scan time. A separate identity
step (the resolver, landing with the identity sprint) reads pending observations
and decides merge / create / send-to-review. That deferral is deliberate — it
is why this schema is safe to ship before identity resolution exists: the tables
fill up with evidence and simply wait, rather than minting duplicate assets.

One-database-per-tenant, so these live in the tenant DB. New tables are created
automatically by modules/compliance/schema_migrations._ensure_for_engine, which
runs Base.metadata.create_all on every tenant engine — no _COLUMN_ADDS entry is
needed for a whole new table (that list is only for columns added to tables that
already exist).
"""

from ._46_ai_budget import *  # noqa: F401,F403 — carries Base + the SQLAlchemy names forward


# ── Vocabularies ─────────────────────────────────────────────────────────────
# Kept as plain module constants (not DB enums) so a new method or state doesn't
# need a schema migration — the same choice the rest of the codebase makes with
# asset_type, lifecycle_state, etc.

DISCOVERY_METHODS = ("network", "active_directory")
SCOPE_KINDS = ("cidr", "ip_range", "ad_ou")
RUN_TRIGGERS = ("manual", "scheduled")
RUN_STATUSES = ("queued", "running", "succeeded", "failed", "cancelled")
JOB_STATUSES = ("queued", "leased", "running", "succeeded", "failed")
# Resolution is owned by the identity step, not by discovery. Everything a scan
# writes starts 'pending' and stays there until the resolver runs.
OBSERVATION_RESOLUTIONS = ("pending", "created", "merged", "review", "ignored")


class DiscoveryCampaign(Base):
    """A named, repeatable discovery job: what to scan and how often."""

    __tablename__ = "grc_discovery_campaigns"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    method = Column(String(30), nullable=False, default="network")  # DISCOVERY_METHODS

    is_active = Column(Boolean, nullable=False, default=True)

    # Scheduling. null schedule_seconds = manual-only; the beat fan-out (next
    # increment) reads next_run_at to decide what is due, exactly like the
    # cloud-connector sync already does.
    schedule_seconds = Column(Integer, nullable=True)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True, index=True)

    # Scan safety — release-blocking before this ever runs unattended (a bank's
    # network cannot take an unthrottled sweep). Present now, nullable, so the
    # schema is stable when the scheduler lands.
    #   blackout_windows: [{ "days": [0-6], "start": "HH:MM", "end": "HH:MM" }]
    blackout_windows = Column(JSON, nullable=True)
    rate_limit_hosts_per_min = Column(Integer, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_by_name = Column(String(255), nullable=True)

    scopes = relationship(
        "DiscoveryScope", back_populates="campaign",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    runs = relationship(
        "DiscoveryRun", back_populates="campaign",
        cascade="all, delete-orphan", passive_deletes=True,
        order_by="DiscoveryRun.id.desc()",
    )

    __table_args__ = (
        Index("ix_grc_discovery_campaigns_tenant_active", "tenant_id", "is_active"),
        # A campaign name is an operator-facing identifier — it shows up in run
        # history, audit logs and the schedule list. Two campaigns called
        # "Corp network" in one tenant makes every one of those ambiguous, so
        # names are unique per tenant (enforced here at the DB and re-checked in
        # the router for a clean 409 instead of a raw IntegrityError).
        UniqueConstraint("tenant_id", "name", name="uq_grc_discovery_campaign_tenant_name"),
    )


class DiscoveryScope(Base):
    """One address range / OU a campaign covers — or an exclusion that subtracts
    from it. A campaign is the union of its non-exclude scopes minus its
    exclude scopes."""

    __tablename__ = "grc_discovery_scopes"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(
        Integer, ForeignKey("grc_discovery_campaigns.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    kind = Column(String(20), nullable=False, default="cidr")  # SCOPE_KINDS
    value = Column(String(500), nullable=False)  # "10.0.0.0/24" | "OU=Servers,DC=corp,DC=local"
    # exclude=True means "never scan this", and always wins over an including
    # scope that overlaps it — the safety default a security team signs off on.
    exclude = Column(Boolean, nullable=False, default=False)
    note = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    campaign = relationship("DiscoveryCampaign", back_populates="scopes")


class DiscoveryRun(Base):
    """One execution of a campaign. The row every 'scan history' view reads."""

    __tablename__ = "grc_discovery_runs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(
        Integer, ForeignKey("grc_discovery_campaigns.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    trigger = Column(String(20), nullable=False, default="manual")  # RUN_TRIGGERS
    status = Column(String(20), nullable=False, default="queued", index=True)  # RUN_STATUSES

    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Aggregate counters, filled as jobs complete. assets_* stay 0 until the
    # identity step resolves this run's observations — discovery itself never
    # touches grc_it_assets.
    hosts_seen = Column(Integer, nullable=False, default=0)
    observations = Column(Integer, nullable=False, default=0)
    assets_new = Column(Integer, nullable=False, default=0)
    assets_updated = Column(Integer, nullable=False, default=0)

    error = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_by_name = Column(String(255), nullable=True)

    campaign = relationship("DiscoveryCampaign", back_populates="runs")
    jobs = relationship(
        "DiscoveryJob", back_populates="run",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    observation_rows = relationship(
        "DiscoveryObservation", back_populates="run",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_grc_discovery_runs_campaign_created", "campaign_id", "created_at"),
    )


class DiscoveryJob(Base):
    """A durable unit of work inside a run — usually one scope. Carries a lease
    and an attempt count so a worker can pick it up, crash, and have another
    worker safely retry it (the queue design the scheduler will build on)."""

    __tablename__ = "grc_discovery_jobs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    run_id = Column(
        Integer, ForeignKey("grc_discovery_runs.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    kind = Column(String(30), nullable=False)  # 'cidr_sweep' | 'ad_enum'
    target = Column(String(500), nullable=False)  # the specific CIDR / OU this job covers
    status = Column(String(20), nullable=False, default="queued", index=True)  # JOB_STATUSES

    # Lease + retry: lease_until guards against two workers running the same
    # job; attempts/max_attempts bound the retries.
    lease_until = Column(DateTime, nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)

    hosts_seen = Column(Integer, nullable=False, default=0)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    run = relationship("DiscoveryRun", back_populates="jobs")


class DiscoveryObservation(Base):
    """Raw evidence for one thing a scan saw, before any identity decision.

    This is the seam between discovery and identity. Discovery writes rows here
    with resolution='pending'; the resolver later reads pending rows, matches
    them against the canonical inventory, and stamps resolved_asset_id +
    resolution. The 'Inbox' view is just the pending + 'review' rows."""

    __tablename__ = "grc_discovery_observations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    run_id = Column(
        Integer, ForeignKey("grc_discovery_runs.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    job_id = Column(
        Integer, ForeignKey("grc_discovery_jobs.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    source = Column(String(50), nullable=False)  # 'cidr' | 'active_directory'
    observed_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Identity hints the resolver will key on. All nullable — a bare ping gives
    # only ip_address; an authenticated probe fills more.
    host_name = Column(String(255), nullable=True, index=True)
    ip_address = Column(String(64), nullable=True, index=True)
    fqdn = Column(String(255), nullable=True)
    mac_address = Column(String(64), nullable=True, index=True)

    # The full evidence blob (open ports, OS guess, reverse-DNS, AD attributes …)
    # kept verbatim so a later resolver change can re-decide without re-scanning.
    raw = Column(JSON, nullable=True)

    resolution = Column(String(20), nullable=False, default="pending", index=True)  # OBSERVATION_RESOLUTIONS
    resolved_asset_id = Column(
        Integer, ForeignKey("grc_it_assets.id", ondelete="SET NULL"), nullable=True,
    )
    resolution_note = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    run = relationship("DiscoveryRun", back_populates="observation_rows")

    __table_args__ = (
        # The Inbox query: unresolved observations for a tenant, newest first.
        Index("ix_grc_discovery_obs_tenant_resolution", "tenant_id", "resolution"),
        # Dedup / correlation lookups the resolver will run.
        Index("ix_grc_discovery_obs_tenant_host", "tenant_id", "host_name"),
    )


class AssetExternalIdentity(Base):
    """A stable external identifier that maps to a canonical asset.

    One asset legitimately carries many external ids — an AWS instance id, a
    ServiceNow sys_id, an endpoint-agent UUID, an Intune device id. Cramming
    them into single columns on grc_it_assets loses that (and forces a schema
    change per source), so they live here as a many-to-one. The resolver's
    strongest match tier is a hit in this table: if an observation arrives with
    (source_system, external_id) already mapped, it IS that asset, full stop.
    """

    __tablename__ = "grc_asset_external_identities"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    asset_id = Column(
        Integer, ForeignKey("grc_it_assets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    source_system = Column(String(50), nullable=False)   # 'aws' | 'servicenow' | 'agent' | 'discovery' …
    external_id = Column(String(500), nullable=False)     # the id in that system
    id_type = Column(String(40), nullable=True)           # 'instance_id' | 'sys_id' | 'agent_uuid' …
    first_seen_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_seen_at = Column(DateTime, nullable=True)

    __table_args__ = (
        # The same external id in the same source can map to only one asset.
        UniqueConstraint("tenant_id", "source_system", "external_id",
                         name="uq_grc_asset_extid_tenant_source_extid"),
        Index("ix_grc_asset_extid_lookup", "tenant_id", "source_system", "external_id"),
    )


# Credential kinds a profile can hold. winrm/ssh drive authenticated host
# inventory (deep-collect); ldap drives AD enumeration.
CREDENTIAL_KINDS = ("winrm", "ssh", "ldap")
SECRET_KINDS = ("password", "ssh_key")


class CredentialProfile(Base):
    """A reusable, encrypted credential the discovery engine authenticates with.

    A network sweep only sees presence; the OS, installed software and
    antivirus/EDR of a host come from an AUTHENTICATED probe. Those credentials
    live here — the secret is stored encrypted (grc.crypto) and is NEVER returned
    to the client. Each profile carries an applicability rule (`applies_to_cidrs`)
    so the collector can pick the right credential for a given host, and a
    priority for when several apply.
    """

    __tablename__ = "grc_credential_profiles"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    kind = Column(String(20), nullable=False)          # CREDENTIAL_KINDS
    username = Column(String(255), nullable=False)
    secret_kind = Column(String(20), nullable=False, default="password")  # SECRET_KINDS
    # Encrypted at rest via grc.crypto.encrypt_secret. Opaque blob; decrypted
    # only inside the collector, never serialised out.
    secret_encrypted = Column(Text, nullable=True)

    domain = Column(String(255), nullable=True)         # AD/WinRM domain
    port = Column(Integer, nullable=True)               # transport port override
    winrm_transport = Column(String(20), nullable=True)  # ntlm | kerberos | …
    # SSH host-key policy — default is to REJECT unknown hosts (safe); an
    # operator can opt a profile into auto-accept for lab use.
    ssh_accept_unknown_hosts = Column(Boolean, nullable=False, default=False)

    # Applicability: which hosts this credential is allowed against. A list of
    # CIDRs; empty/null means "any host in the tenant". Lower priority number
    # wins when several profiles apply to the same host.
    applies_to_cidrs = Column(JSON, nullable=True)
    priority = Column(Integer, nullable=False, default=100)

    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_by_name = Column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_grc_credential_profile_tenant_name"),
        Index("ix_grc_credential_profiles_tenant_kind", "tenant_id", "kind", "is_active"),
    )
