"""CMDB ← ComplyVerse inventory sync — grc/modules/helpdesk_native/cmdb_sync.py.

Covers spec §9: mapping waterfall; scope excludes adhoc/pentest-adhoc; apex
grouping + REL-CONTAINS; idempotent 2nd run; retire + restore; software child +
edge + removal on re-sync; PCI derivation; dry run writes nothing.

Harness mirrors tests/test_cmdb_admin.py: in-memory SQLite, tables created
directly, service called with a plain Session + fake tenant id (RBAC/HTTP layer
bypassed).
"""
import os

os.environ.setdefault("SESSION_SECRET", "localdev-cmdb-sync")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    AuditLog,
    GRCUser,
    HDBusinessService,
    HDCIAttribute,
    HDCIRelationship,
    HDCIRelationshipType,
    HDCIType,
    HDConfigurationItem,
    HDImportBatch,
    ITAsset,
    Tenant,
)
from grc.modules.helpdesk_native import cmdb_admin as adm
from grc.modules.helpdesk_native import cmdb_sync as m

TENANT = 1

TABLES = (
    Tenant, GRCUser, AuditLog, ITAsset, HDImportBatch,
    HDCIType, HDCIAttribute, HDConfigurationItem,
    HDCIRelationshipType, HDCIRelationship, HDBusinessService,
)

CI_TYPE_CODES = [
    ("CIT-SERVER", "Server"), ("CIT-WORKSTATION", "Workstation"),
    ("CIT-WEBSVC", "Web Service"), ("CIT-DBINST", "Database Instance"),
    ("CIT-NETDEV", "Network Device"), ("CIT-CLOUDSVC", "Cloud Service"),
    ("CIT-K8S", "Kubernetes Cluster"), ("CIT-APP", "Application"),
]
REL_TYPES = [
    ("REL-CONTAINS", "Contains", "Part of"),
    ("REL-INSTALLED", "Installed on", "Has installed"),
    ("REL-RUNSON", "Runs on", "Runs"),
]


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for t in TABLES:
        t.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=TENANT, name="Acme", slug="acme"))
    for code, name in CI_TYPE_CODES:
        s.add(HDCIType(tenant_id=TENANT, code=code, name=name))
    for code, name, inv in REL_TYPES:
        s.add(HDCIRelationshipType(tenant_id=TENANT, code=code, name=name, inverse_name=inv))
    s.commit()
    yield s
    s.close()


def _asset(s, **kw):
    kw.setdefault("tenant_id", TENANT)
    kw.setdefault("asset_type", "infrastructure")
    row = ITAsset(**kw)
    s.add(row)
    s.commit()
    return row


def _sync(db, dry_run=False):
    return m.sync_inventory_to_cmdb(db, TENANT, dry_run=dry_run, actor_email=None)


def _ci_count(db):
    return db.query(HDConfigurationItem).filter(HDConfigurationItem.tenant_id == TENANT).count()


# ═══════════════════════════════════════════════════════════════════════════
# §2 mapping waterfall (pure)
# ═══════════════════════════════════════════════════════════════════════════
class _A:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def test_map_ci_type_waterfall():
    # 1. platform_kind wins first
    assert m.map_ci_type_code(_A(platform_kind="database", asset_type="web"), "easm") == "CIT-DBINST"
    assert m.map_ci_type_code(_A(platform_kind="network"), "manual") == "CIT-NETDEV"
    # platform_kind='server' is the generic host model: a Windows 11 Pro desktop
    # (the real DESKTOP-* inventory rows) is a workstation, a Windows Server stays a server.
    desk = _A(platform_kind="server", os_family="windows",
              os_version="Microsoft Windows 11 Pro 25H2", os_edition="Pro")
    assert m.map_ci_type_code(desk, "uncredential") == "CIT-WORKSTATION"
    wsrv = _A(platform_kind="server", os_family="windows",
              os_version="Microsoft Windows Server 2022 Datacenter", os_edition="Datacenter")
    assert m.map_ci_type_code(wsrv, "credential") == "CIT-SERVER"
    assert m.map_ci_type_code(_A(platform_kind="server"), "manual") == "CIT-SERVER"
    assert m.map_ci_type_code(_A(platform_kind="cluster"), "manual") == "CIT-K8S"
    assert m.map_ci_type_code(_A(platform_kind="identity"), "manual") == "CIT-APP"
    # 2. asset_role application
    assert m.map_ci_type_code(_A(platform_kind=None, asset_role="application"), "manual") == "CIT-APP"
    # 3. asset_type
    assert m.map_ci_type_code(_A(platform_kind=None, asset_role=None, asset_type="web"), "manual") == "CIT-WEBSVC"
    assert m.map_ci_type_code(_A(platform_kind=None, asset_role=None, asset_type="data"), "manual") == "CIT-DBINST"
    # 4. os_family: windows client → workstation
    win = _A(platform_kind=None, asset_role=None, asset_type="infrastructure",
             os_family="windows", os_version="Microsoft Windows 11 Pro 23H2",
             os_normalized="windows-11-23H2", os_edition="Pro", os_build="23H2")
    assert m.map_ci_type_code(win, "credential") == "CIT-WORKSTATION"
    # 4. os_family: windows SERVER → server
    srv = _A(platform_kind=None, asset_role=None, asset_type="infrastructure",
             os_family="windows", os_version="Windows Server 2019",
             os_normalized="windows-server-2019", os_edition="Datacenter", os_build=None)
    assert m.map_ci_type_code(srv, "credential") == "CIT-SERVER"
    # 4. macOS → workstation
    mac = _A(platform_kind=None, asset_role=None, asset_type="infrastructure",
             os_family="macos", os_version="macOS 14", os_normalized="macos-14",
             os_edition=None, os_build=None)
    assert m.map_ci_type_code(mac, "credential") == "CIT-WORKSTATION"
    # 5. easm with no other signal → web service
    bare = _A(platform_kind=None, asset_role=None, asset_type="infrastructure",
              os_family=None)
    assert m.map_ci_type_code(bare, "easm") == "CIT-WEBSVC"
    # 6. fallback → server
    assert m.map_ci_type_code(bare, "manual") == "CIT-SERVER"


# ═══════════════════════════════════════════════════════════════════════════
# §3 PCI derivation (pure)
# ═══════════════════════════════════════════════════════════════════════════
def test_pci_derivation():
    assert m._derive_pci(_A(regulated_data_type="pci", cde_environment=False, compliance_scope=[])) is True
    assert m._derive_pci(_A(regulated_data_type="multiple", cde_environment=False, compliance_scope=[])) is True
    assert m._derive_pci(_A(regulated_data_type="none", cde_environment=True, compliance_scope=[])) is True
    assert m._derive_pci(_A(regulated_data_type="none", cde_environment=False, compliance_scope=["PCI-DSS"])) is True
    assert m._derive_pci(_A(regulated_data_type="pii", cde_environment=False, compliance_scope=["HIPAA"])) is False
    assert m._derive_pci(_A(regulated_data_type=None, cde_environment=None, compliance_scope=None)) is False


# ═══════════════════════════════════════════════════════════════════════════
# scope excludes ad-hoc / pentest-adhoc
# ═══════════════════════════════════════════════════════════════════════════
def test_scope_excludes_adhoc(db):
    _asset(db, name="real.example.com", internet_facing=True, origin_source="easm")
    _asset(db, name="DESKTOP-1", internet_facing=False, discovery_state="managed")
    # transient AI-pentest ad-hoc targets — must be excluded
    _asset(db, name="ginandjuice.shop", status="adhoc", last_seen_source="pentest-adhoc",
           internet_facing=True)
    out = _sync(db, dry_run=True)
    assert out["inventory_count"] == 2, out
    # neither created CI references the ad-hoc row
    assert all(s["name"] != "ginandjuice.shop" for s in out["sample"])


# ═══════════════════════════════════════════════════════════════════════════
# §2b apex grouping + REL-CONTAINS
# ═══════════════════════════════════════════════════════════════════════════
def test_apex_grouping_and_contains(db):
    # superior.edu.pk apex present + 2 subdomains; testfire has no apex row
    _asset(db, name="superior.edu.pk", internet_facing=True, origin_source="easm")
    _asset(db, name="www.superior.edu.pk", internet_facing=True, origin_source="easm")
    _asset(db, name="adfs.superior.edu.pk", internet_facing=True, origin_source="easm")
    _asset(db, name="demo.testfire.net", internet_facing=True, origin_source="easm")
    out = _sync(db, dry_run=False)
    assert out["by_exposure"]["external_domains"] == 2, out["by_exposure"]
    # 3 endpoints: www + adfs (superior) + demo (testfire synthetic apex)
    assert out["by_exposure"]["external_endpoints"] == 3, out["by_exposure"]

    cis = {c.code: c for c in db.query(HDConfigurationItem).all()}
    # superior apex row doubles as the domain CI
    apex = db.query(HDConfigurationItem).filter(HDConfigurationItem.name == "superior.edu.pk").first()
    assert apex.attributes["ava"]["kind"] == "domain"
    assert apex.attributes["ava"]["domain"]["apex"] == "superior.edu.pk"
    assert apex.attributes["ava"]["domain"]["endpoint_count"] == 2
    # testfire has a SYNTHETIC domain CI
    synth = cis.get("CV-DOM-testfire.net")
    assert synth is not None and synth.ava_asset_id is None
    assert synth.attributes["ava"]["kind"] == "domain"

    # REL-CONTAINS edges: domain → each endpoint (2 superior + 1 testfire)
    contains = db.query(HDCIRelationshipType).filter(HDCIRelationshipType.code == "REL-CONTAINS").first()
    edges = db.query(HDCIRelationship).filter(HDCIRelationship.rel_type_id == contains.id).all()
    assert len(edges) == 3, len(edges)
    # every endpoint CI has the domain as source
    assert all(e.source_ci_id in (apex.id, synth.id) for e in edges)


# ═══════════════════════════════════════════════════════════════════════════
# idempotent second run
# ═══════════════════════════════════════════════════════════════════════════
def test_idempotent_second_run(db):
    _asset(db, name="superior.edu.pk", internet_facing=True, origin_source="easm")
    _asset(db, name="www.superior.edu.pk", internet_facing=True, origin_source="easm")
    _asset(db, name="DESKTOP-EQ", internet_facing=False, discovery_state="managed",
           os_family="windows", os_version="Windows 11 Pro", os_normalized="windows-11")
    first = _sync(db, dry_run=False)
    assert first["created"] > 0
    n = _ci_count(db)
    second = _sync(db, dry_run=False)
    assert second["created"] == 0, second
    assert second["updated"] == 0, second
    assert second["relationships_created"] == 0, second
    assert _ci_count(db) == n


# ═══════════════════════════════════════════════════════════════════════════
# retire + restore
# ═══════════════════════════════════════════════════════════════════════════
def test_retire_and_restore(db):
    a = _asset(db, name="host-a.example.com", internet_facing=True, origin_source="easm")
    _sync(db, dry_run=False)
    ci = db.query(HDConfigurationItem).filter(HDConfigurationItem.ava_asset_id == a.id).first()
    assert ci.status == "in_use"

    # asset leaves inventory scope (becomes an ad-hoc target)
    a.status = "adhoc"
    a.last_seen_source = "pentest-adhoc"
    db.commit()
    out = _sync(db, dry_run=False)
    assert out["retired"] >= 1, out
    db.refresh(ci)
    assert ci.status == "retired"

    # asset returns to inventory → restored
    a.status = "active"
    a.last_seen_source = "easm"
    db.commit()
    out = _sync(db, dry_run=False)
    assert out["restored"] >= 1, out
    db.refresh(ci)
    assert ci.status == "in_use"


# ═══════════════════════════════════════════════════════════════════════════
# §4 software child + edge + removal on re-sync
# ═══════════════════════════════════════════════════════════════════════════
def test_software_child_edge_and_removal(db):
    host = _asset(
        db, name="DESKTOP-SW", internet_facing=False, discovery_state="managed",
        os_family="windows", os_version="Windows 11 Pro", os_normalized="windows-11",
        detected_software_json=[
            {"software_key": "chrome", "name": "Google Chrome", "version": "120",
             "publisher": "Google", "source": "agent", "benchmark_available": False},
            {"software_key": "7zip", "name": "7-Zip", "version": "23.01",
             "publisher": "Igor Pavlov", "source": "agent", "benchmark_available": False},
        ],
    )
    out = _sync(db, dry_run=False)
    assert out["software_created"] == 2, out
    # CIT-SOFTWARE type was ensured
    swtype = db.query(HDCIType).filter(HDCIType.code == "CIT-SOFTWARE").first()
    assert swtype is not None
    sw_cis = db.query(HDConfigurationItem).filter(HDConfigurationItem.ci_type_id == swtype.id).all()
    assert len(sw_cis) == 2
    # REL-INSTALLED edges: software → host
    installed = db.query(HDCIRelationshipType).filter(HDCIRelationshipType.code == "REL-INSTALLED").first()
    host_ci = db.query(HDConfigurationItem).filter(HDConfigurationItem.ava_asset_id == host.id).first()
    edges = db.query(HDCIRelationship).filter(HDCIRelationship.rel_type_id == installed.id).all()
    assert len(edges) == 2
    assert all(e.target_ci_id == host_ci.id for e in edges)

    # drop one software entry → that software CI retired + its edge removed
    host.detected_software_json = [
        {"software_key": "chrome", "name": "Google Chrome", "version": "120",
         "publisher": "Google", "source": "agent", "benchmark_available": False},
    ]
    db.commit()
    out2 = _sync(db, dry_run=False)
    assert out2["software_retired"] == 1, out2
    assert out2["relationships_removed"] >= 1, out2
    edges2 = db.query(HDCIRelationship).filter(HDCIRelationship.rel_type_id == installed.id).all()
    assert len(edges2) == 1
    retired_sw = db.query(HDConfigurationItem).filter(
        HDConfigurationItem.ci_type_id == swtype.id,
        HDConfigurationItem.status == "retired",
    ).all()
    assert len(retired_sw) == 1


# ═══════════════════════════════════════════════════════════════════════════
# dry run writes nothing
# ═══════════════════════════════════════════════════════════════════════════
def test_dry_run_writes_nothing(db):
    _asset(db, name="superior.edu.pk", internet_facing=True, origin_source="easm")
    _asset(db, name="www.superior.edu.pk", internet_facing=True, origin_source="easm")
    _asset(db, name="DESKTOP-DRY", internet_facing=False, discovery_state="managed",
           detected_software_json=[{"software_key": "chrome", "name": "Chrome"}])
    before_ci = _ci_count(db)
    before_edges = db.query(HDCIRelationship).count()
    before_batch = db.query(HDImportBatch).count()
    before_swtype = db.query(HDCIType).filter(HDCIType.code == "CIT-SOFTWARE").count()

    out = _sync(db, dry_run=True)
    assert out["dry_run"] is True
    assert out["created"] > 0  # it PLANNED creates
    # ...but wrote nothing
    assert _ci_count(db) == before_ci
    assert db.query(HDCIRelationship).count() == before_edges
    assert db.query(HDImportBatch).count() == before_batch
    assert db.query(HDCIType).filter(HDCIType.code == "CIT-SOFTWARE").count() == before_swtype


# ═══════════════════════════════════════════════════════════════════════════
# synthetic domain CI inherits exposure/category from its members (coordinator fix)
# ═══════════════════════════════════════════════════════════════════════════
def test_synthetic_domain_inherits_member_exposure(db):
    # testfire.net has no apex inventory row → a SYNTHETIC domain CI; its endpoints
    # are internet-facing EASM, one is PCI.
    _asset(db, name="demo.testfire.net", internet_facing=True, origin_source="easm",
           regulated_data_type="pci")
    _asset(db, name="www.testfire.net", internet_facing=True, origin_source="easm")
    _sync(db, dry_run=False)

    synth = db.query(HDConfigurationItem).filter(
        HDConfigurationItem.code == "CV-DOM-testfire.net").first()
    assert synth is not None and synth.ava_asset_id is None
    ava = synth.attributes["ava"]
    assert ava["kind"] == "domain"
    assert ava["source"]["category"] == "easm"          # all members easm
    assert ava["network"]["internet_facing"] is True    # any member internet-facing
    assert ava["compliance"]["pci"] is True             # any member PCI

    # the row derivation (shared helper) now yields external / easm / pci / managed
    d = adm._inventory_derived(synth)
    assert d["exposure"] == "external"
    assert d["source_category"] == "easm"
    assert d["pci"] is True and d["internet_facing"] is True
    assert d["managed_by_inventory"] is True            # sync-owned → PATCH/retire-guarded

    # idempotent: unchanged members → second run reports it unchanged
    second = _sync(db, dry_run=False)
    assert second["created"] == 0 and second["updated"] == 0, second


def test_default_business_service_mapping(db):
    """Workstations map to the Managed Workstation service and installed software to
    the Desktop Software service (by code, only when empty). Web endpoints stay
    unmapped (no honest 1:1 internal service). Idempotent + admin-assignment safe."""
    svc_ws = HDBusinessService(tenant_id=TENANT, code="SVC-0001",
                               name="Managed Workstation (Laptop/Desktop)")
    svc_sw = HDBusinessService(tenant_id=TENANT, code="SVC-0002",
                               name="Desktop Software & Patching")
    db.add_all([svc_ws, svc_sw])
    db.commit()
    _asset(db, name="DESKTOP-TEST", platform_kind="server", os_family="windows",
           os_version="Microsoft Windows 11 Pro 25H2", os_edition="Pro",
           detected_software_json=[{"name": "Google Chrome", "version": "1.0"}])
    _asset(db, name="site.example.com", asset_type="web", is_internet_facing=True)
    _sync(db)
    cis = {c.name: c for c in db.query(HDConfigurationItem).filter_by(tenant_id=TENANT).all()}
    # workstation → Managed Workstation
    assert cis["DESKTOP-TEST"].business_service_id == svc_ws.id
    # its installed-software child CI (code CV-SW-*) → Desktop Software & Patching
    sw = [c for c in cis.values() if c.code.startswith("CV-SW-")]
    assert sw and all(c.business_service_id == svc_sw.id for c in sw)
    # web endpoint/domain CIs (the example.com apex + site.example.com) stay
    # unmapped — no honest 1:1 internal service for external web assets
    web = [c for c in cis.values() if "example.com" in c.name]
    assert web and all(c.business_service_id is None for c in web)
    # re-fill only when empty + idempotent: clearing refills, a 2nd run is a no-op
    cis["DESKTOP-TEST"].business_service_id = None
    db.commit()
    _sync(db)
    assert db.query(HDConfigurationItem).filter_by(
        tenant_id=TENANT, code=cis["DESKTOP-TEST"].code).first().business_service_id == svc_ws.id
    third = _sync(db)
    assert third["created"] == 0 and third["updated"] == 0, third


def test_autocreate_ci_and_rel_types_on_empty_tenant():
    """QA regression: a fresh CMDB with NO CI types used to SKIP every host
    ('CI type CIT-SERVER does not exist in tenant') — syncing 0 of N assets. The
    sync must now AUTO-CREATE the CI types (and relationship types) it needs, so
    'sync from inventory' works out of the box with zero manual setup."""
    engine = create_engine("sqlite://")
    for t in TABLES:
        t.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=TENANT, name="Acme", slug="acme"))
    s.commit()
    # Deliberately seed NO HDCIType / HDCIRelationshipType — the bug scenario.
    _asset(s, name="win-srv-01", platform_kind="server")
    _asset(s, name="DESKTOP-1", platform_kind="server", os_family="windows",
           os_version="Microsoft Windows 11 Pro 23H2", os_edition="Pro")
    out = m.sync_inventory_to_cmdb(s, TENANT, dry_run=False, actor_email=None)
    # hosts created, NOT skipped for a missing type
    missing = [x for x in out["skipped"] if "does not exist" in (x.get("reason") or "")]
    assert out["created"] >= 2, out
    assert not missing, missing
    # the needed CI types were auto-created
    assert s.query(HDCIType).filter_by(tenant_id=TENANT, code="CIT-SERVER").first() is not None
    assert s.query(HDCIType).filter_by(tenant_id=TENANT, code="CIT-WORKSTATION").first() is not None
    s.close()


def test_autocreate_dry_run_plans_without_writing():
    """Same empty tenant, dry run: it must PLAN the host creates (created>0, no
    'does not exist' skips) yet write no CI types."""
    engine = create_engine("sqlite://")
    for t in TABLES:
        t.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=TENANT, name="Acme", slug="acme"))
    s.commit()
    _asset(s, name="win-srv-02", platform_kind="server")
    out = m.sync_inventory_to_cmdb(s, TENANT, dry_run=True, actor_email=None)
    missing = [x for x in out["skipped"] if "does not exist" in (x.get("reason") or "")]
    assert out["created"] >= 1 and not missing, out
    assert s.query(HDCIType).filter_by(tenant_id=TENANT).count() == 0  # dry run wrote nothing
    s.close()
