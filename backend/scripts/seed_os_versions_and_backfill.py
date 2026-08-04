"""Seed grc_os_versions + backfill grc_compliance_plugins.os_keys.

The package's library-tree endpoint walks two tables:
  1. grc_os_versions — the canonical OS knowledge graph (family → product
     → build hierarchy via parent_key).
  2. grc_compliance_plugins.os_keys — a JSON array of normalized_key strings
     each rule applies to.

Without seed data the tree query returns zero rows and the UI shows
"Couldn't load the library tree" — even though the schema is fine.

This script:
  A) Seeds ~50 OS rows per tenant covering Windows / Linux / Cisco /
     databases / cloud / containers / macOS — every family the CIS
     catalogue ships rules for.
  B) Backfills os_keys for every existing plugin row, deriving the keys
     from the plugin's benchmark name (e.g. CIS_Microsoft_Windows_11_
     Enterprise_Benchmark_v5.0.1 → ['windows', 'windows-11']).
     Operators can later refine via the /classify endpoint (AI).

Idempotent — re-running won't dupe rows (ON CONFLICT DO NOTHING) and
only updates os_keys when the array is empty.

Usage:
    python -m scripts.seed_os_versions_and_backfill
"""
from dotenv import load_dotenv
load_dotenv()

import logging
import re
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

from grc.models import SessionLocal, Tenant
from grc.db import open_tenant_session
from sqlalchemy import text


# ─── A. OS knowledge graph ─────────────────────────────────────────────
# (family, product, build, normalized_key, parent_key, display_name,
#  release_year, eol_year, is_supported, benchmark_hint)
OS_SEED = [
    # Windows family roots
    ("windows", None, None, "windows", None, "Windows", None, None, True, None),
    # Windows 11 + builds
    ("windows", "windows-11", None, "windows-11", "windows", "Windows 11", 2021, 2031, True,
        "CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1"),
    ("windows", "windows-11", "22H2", "windows-11-22H2", "windows-11", "Windows 11 — 22H2", 2022, 2025, True, None),
    ("windows", "windows-11", "23H2", "windows-11-23H2", "windows-11", "Windows 11 — 23H2", 2023, 2026, True, None),
    ("windows", "windows-11", "24H2", "windows-11-24H2", "windows-11", "Windows 11 — 24H2", 2024, 2027, True, None),
    ("windows", "windows-11", "25H2", "windows-11-25H2", "windows-11", "Windows 11 — 25H2 (Insider)", 2025, 2028, True, None),
    # Windows 10 + builds
    ("windows", "windows-10", None, "windows-10", "windows", "Windows 10", 2015, 2025, True,
        "CIS_Microsoft_Windows_10_Enterprise_Benchmark_v4.0.0"),
    ("windows", "windows-10", "21H2", "windows-10-21H2", "windows-10", "Windows 10 — 21H2", 2021, 2025, True, None),
    ("windows", "windows-10", "22H2", "windows-10-22H2", "windows-10", "Windows 10 — 22H2", 2022, 2025, True, None),
    # Windows Server
    ("windows", "windows-server-2025", None, "windows-server-2025", "windows", "Windows Server 2025", 2024, 2034, True,
        "CIS_Microsoft_Windows_Server_2025_Benchmark"),
    ("windows", "windows-server-2022", None, "windows-server-2022", "windows", "Windows Server 2022", 2021, 2031, True,
        "CIS_Microsoft_Windows_Server_2022_Benchmark_v4.0.0"),
    ("windows", "windows-server-2019", None, "windows-server-2019", "windows", "Windows Server 2019", 2018, 2029, True,
        "CIS_Microsoft_Windows_Server_2019_Benchmark_v3.0.1"),
    ("windows", "windows-server-2016", None, "windows-server-2016", "windows", "Windows Server 2016", 2016, 2027, True,
        "CIS_Microsoft_Windows_Server_2016_Benchmark"),
    ("windows", "windows-server-2012", None, "windows-server-2012", "windows", "Windows Server 2012 R2", 2012, 2023, False,
        "CIS_Microsoft_Windows_Server_2012_R2_Benchmark"),

    # Linux family
    ("linux", None, None, "linux", None, "Linux", None, None, True, None),
    ("linux", "ubuntu", None, "ubuntu", "linux", "Ubuntu", None, None, True, None),
    ("linux", "ubuntu", "24.04", "ubuntu-24.04", "ubuntu", "Ubuntu 24.04 LTS", 2024, 2034, True,
        "CIS_Ubuntu_Linux_24.04_LTS_Benchmark"),
    ("linux", "ubuntu", "22.04", "ubuntu-22.04", "ubuntu", "Ubuntu 22.04 LTS", 2022, 2027, True,
        "CIS_Ubuntu_Linux_22.04_LTS_Benchmark_v3.0.0"),
    ("linux", "ubuntu", "20.04", "ubuntu-20.04", "ubuntu", "Ubuntu 20.04 LTS", 2020, 2025, True,
        "CIS_Ubuntu_Linux_20.04_LTS_Benchmark"),
    ("linux", "debian", None, "debian", "linux", "Debian", None, None, True, None),
    ("linux", "debian", "12", "debian-12", "debian", "Debian 12", 2023, 2028, True, None),
    ("linux", "debian", "11", "debian-11", "debian", "Debian 11", 2021, 2026, True, None),
    ("linux", "rhel", None, "rhel", "linux", "Red Hat Enterprise Linux", None, None, True, None),
    ("linux", "rhel", "9", "rhel-9", "rhel", "RHEL 9", 2022, 2032, True,
        "CIS_Red_Hat_Enterprise_Linux_9_Benchmark"),
    ("linux", "rhel", "8", "rhel-8", "rhel", "RHEL 8", 2019, 2029, True,
        "CIS_Red_Hat_Enterprise_Linux_8_Benchmark"),
    ("linux", "almalinux", None, "almalinux", "linux", "AlmaLinux", None, None, True, None),
    ("linux", "almalinux", "9", "almalinux-9", "almalinux", "AlmaLinux 9", 2022, 2032, True, None),
    ("linux", "almalinux", "8", "almalinux-8", "almalinux", "AlmaLinux 8", 2021, 2029, True, None),
    ("linux", "oraclelinux", None, "oraclelinux", "linux", "Oracle Linux", None, None, True, None),
    ("linux", "oraclelinux", "9", "oraclelinux-9", "oraclelinux", "Oracle Linux 9", 2022, 2032, True, None),
    ("linux", "oraclelinux", "8", "oraclelinux-8", "oraclelinux", "Oracle Linux 8", 2019, 2029, True, None),
    ("linux", "amazonlinux", None, "amazonlinux", "linux", "Amazon Linux", None, None, True, None),
    ("linux", "amazonlinux", "2023", "amazonlinux-2023", "amazonlinux", "Amazon Linux 2023", 2023, 2028, True, None),
    ("linux", "amazonlinux", "2", "amazonlinux-2", "amazonlinux", "Amazon Linux 2", 2018, 2025, True, None),
    ("linux", "rocky", None, "rocky", "linux", "Rocky Linux", None, None, True, None),
    ("linux", "rocky", "9", "rocky-9", "rocky", "Rocky Linux 9", 2022, 2032, True, None),
    ("linux", "rocky", "8", "rocky-8", "rocky", "Rocky Linux 8", 2021, 2029, True, None),

    # Cisco network family
    ("cisco", None, None, "cisco", None, "Cisco", None, None, True, None),
    ("cisco", "cisco-ios", None, "cisco-ios", "cisco", "Cisco IOS", None, None, True,
        "CIS_Cisco_IOS_15_Benchmark"),
    ("cisco", "cisco-ios-xe", None, "cisco-ios-xe", "cisco", "Cisco IOS-XE", None, None, True,
        "CIS_Cisco_IOS_XE_17_Benchmark"),
    ("cisco", "cisco-nx-os", None, "cisco-nx-os", "cisco", "Cisco NX-OS", None, None, True, None),
    ("cisco", "cisco-asa", None, "cisco-asa", "cisco", "Cisco ASA", None, None, True, None),
    ("cisco", "cisco-firepower", None, "cisco-firepower", "cisco", "Cisco Firepower", None, None, True, None),

    # Databases family
    ("db", None, None, "db", None, "Databases", None, None, True, None),
    ("db", "oracle-db", None, "oracle-db", "db", "Oracle Database", None, None, True, None),
    ("db", "oracle-db", "19c", "oracle-db-19c", "oracle-db", "Oracle DB 19c", 2019, 2027, True,
        "CIS_Oracle_Database_19c_Benchmark"),
    ("db", "oracle-db", "21c", "oracle-db-21c", "oracle-db", "Oracle DB 21c", 2021, 2029, True, None),
    ("db", "oracle-db", "23ai", "oracle-db-23ai", "oracle-db", "Oracle DB 23ai", 2024, 2033, True, None),
    ("db", "mssql", None, "mssql", "db", "Microsoft SQL Server", None, None, True, None),
    ("db", "mssql", "2022", "mssql-2022", "mssql", "MSSQL 2022", 2022, 2032, True,
        "CIS_Microsoft_SQL_Server_2022_Benchmark"),
    ("db", "mssql", "2019", "mssql-2019", "mssql", "MSSQL 2019", 2019, 2030, True, None),
    ("db", "postgres", None, "postgres", "db", "PostgreSQL", None, None, True, None),
    ("db", "postgres", "16", "postgres-16", "postgres", "PostgreSQL 16", 2023, 2028, True,
        "CIS_PostgreSQL_16_Benchmark"),
    ("db", "postgres", "15", "postgres-15", "postgres", "PostgreSQL 15", 2022, 2027, True, None),
    ("db", "mysql", None, "mysql", "db", "MySQL", None, None, True, None),
    ("db", "mysql", "8.0", "mysql-8.0", "mysql", "MySQL 8.0", 2018, 2026, True, None),

    # Cloud accounts (no parent — treated as standalone families)
    ("cloud", None, None, "cloud", None, "Cloud Accounts", None, None, True, None),
    ("cloud", "aws-account", None, "aws-account", "cloud", "AWS Account", None, None, True,
        "CIS_Amazon_Web_Services_Foundations_Benchmark"),
    ("cloud", "azure-account", None, "azure-account", "cloud", "Azure Subscription", None, None, True,
        "CIS_Microsoft_Azure_Foundations_Benchmark"),
    ("cloud", "gcp-account", None, "gcp-account", "cloud", "GCP Project", None, None, True,
        "CIS_Google_Cloud_Platform_Foundation_Benchmark"),

    # Containers
    ("container", None, None, "container", None, "Containers", None, None, True, None),
    ("container", "kubernetes", None, "kubernetes", "container", "Kubernetes", None, None, True, None),
    ("container", "kubernetes", "1.30", "kubernetes-1.30", "kubernetes", "Kubernetes 1.30", 2024, 2026, True,
        "CIS_Kubernetes_Benchmark"),
    ("container", "kubernetes", "1.29", "kubernetes-1.29", "kubernetes", "Kubernetes 1.29", 2024, 2025, True, None),
    ("container", "docker", None, "docker", "container", "Docker", None, None, True, None),

    # macOS
    ("macos", None, None, "macos", None, "macOS", None, None, True, None),
    ("macos", "macos", "15", "macos-15", "macos", "macOS 15 Sequoia", 2024, 2027, True, None),
    ("macos", "macos", "14", "macos-14", "macos", "macOS 14 Sonoma", 2023, 2026, True, None),
    ("macos", "macos", "13", "macos-13", "macos", "macOS 13 Ventura", 2022, 2025, True, None),
]


# ─── B. Benchmark → os_keys derivation ─────────────────────────────────
# Pattern-match the plugin's benchmark string and emit a list of
# normalized_keys covering the full hierarchy (family-walk).
_BENCHMARK_RULES = [
    # Windows 11
    (re.compile(r"Microsoft_?Windows[_ ]?11", re.I),    ["windows", "windows-11"]),
    # Windows 10
    (re.compile(r"Microsoft_?Windows[_ ]?10", re.I),    ["windows", "windows-10"]),
    # Windows Server
    (re.compile(r"Microsoft_?Windows[_ ]?Server[_ ]?2025", re.I),  ["windows", "windows-server-2025"]),
    (re.compile(r"Microsoft_?Windows[_ ]?Server[_ ]?2022", re.I),  ["windows", "windows-server-2022"]),
    (re.compile(r"Microsoft_?Windows[_ ]?Server[_ ]?2019", re.I),  ["windows", "windows-server-2019"]),
    (re.compile(r"Microsoft_?Windows[_ ]?Server[_ ]?2016", re.I),  ["windows", "windows-server-2016"]),
    (re.compile(r"Microsoft_?Windows[_ ]?Server[_ ]?2012", re.I),  ["windows", "windows-server-2012"]),
    # Ubuntu
    (re.compile(r"Ubuntu[_ ]?(?:Linux[_ ]?)?24[._]04", re.I),      ["linux", "ubuntu", "ubuntu-24.04"]),
    (re.compile(r"Ubuntu[_ ]?(?:Linux[_ ]?)?22[._]04", re.I),      ["linux", "ubuntu", "ubuntu-22.04"]),
    (re.compile(r"Ubuntu[_ ]?(?:Linux[_ ]?)?20[._]04", re.I),      ["linux", "ubuntu", "ubuntu-20.04"]),
    # Debian
    (re.compile(r"Debian[_ ]?(?:Linux[_ ]?)?12", re.I),            ["linux", "debian", "debian-12"]),
    (re.compile(r"Debian[_ ]?(?:Linux[_ ]?)?11", re.I),            ["linux", "debian", "debian-11"]),
    # RHEL
    (re.compile(r"Red[_ ]?Hat[_ ]?Enterprise[_ ]?Linux[_ ]?9", re.I), ["linux", "rhel", "rhel-9"]),
    (re.compile(r"Red[_ ]?Hat[_ ]?Enterprise[_ ]?Linux[_ ]?8", re.I), ["linux", "rhel", "rhel-8"]),
    (re.compile(r"\bRHEL[_ ]?9", re.I),                            ["linux", "rhel", "rhel-9"]),
    (re.compile(r"\bRHEL[_ ]?8", re.I),                            ["linux", "rhel", "rhel-8"]),
    # AlmaLinux / Rocky / Oracle Linux / Amazon Linux
    (re.compile(r"AlmaLinux[_ ]?(?:OS[_ ]?)?9", re.I),             ["linux", "almalinux", "almalinux-9"]),
    (re.compile(r"AlmaLinux[_ ]?(?:OS[_ ]?)?8", re.I),             ["linux", "almalinux", "almalinux-8"]),
    (re.compile(r"Rocky[_ ]?Linux[_ ]?9", re.I),                   ["linux", "rocky", "rocky-9"]),
    (re.compile(r"Rocky[_ ]?Linux[_ ]?8", re.I),                   ["linux", "rocky", "rocky-8"]),
    (re.compile(r"Oracle[_ ]?Linux[_ ]?9", re.I),                  ["linux", "oraclelinux", "oraclelinux-9"]),
    (re.compile(r"Oracle[_ ]?Linux[_ ]?8", re.I),                  ["linux", "oraclelinux", "oraclelinux-8"]),
    (re.compile(r"Amazon[_ ]?Linux[_ ]?2023", re.I),               ["linux", "amazonlinux", "amazonlinux-2023"]),
    (re.compile(r"Amazon[_ ]?Linux[_ ]?2(?!02)", re.I),            ["linux", "amazonlinux", "amazonlinux-2"]),
    # Generic Linux fallback (e.g. SUSE benchmarks)
    (re.compile(r"\bSUSE[_ ]?Linux", re.I),                        ["linux"]),
    # Cisco
    (re.compile(r"Cisco[_ ]?IOS[_ ]?XE", re.I),                    ["cisco", "cisco-ios-xe"]),
    (re.compile(r"Cisco[_ ]?IOS\b", re.I),                         ["cisco", "cisco-ios"]),
    (re.compile(r"Cisco[_ ]?NX[_-]?OS", re.I),                     ["cisco", "cisco-nx-os"]),
    (re.compile(r"Cisco[_ ]?ASA", re.I),                           ["cisco", "cisco-asa"]),
    (re.compile(r"Cisco[_ ]?Firepower", re.I),                     ["cisco", "cisco-firepower"]),
    # Oracle DB
    (re.compile(r"Oracle[_ ]?Database[_ ]?19c", re.I),             ["db", "oracle-db", "oracle-db-19c"]),
    (re.compile(r"Oracle[_ ]?Database[_ ]?21c", re.I),             ["db", "oracle-db", "oracle-db-21c"]),
    (re.compile(r"Oracle[_ ]?Database[_ ]?23(?:c|ai)", re.I),      ["db", "oracle-db", "oracle-db-23ai"]),
    (re.compile(r"Oracle[_ ]?Database", re.I),                     ["db", "oracle-db"]),
    # MSSQL
    (re.compile(r"(?:Microsoft[_ ]?)?SQL[_ ]?Server[_ ]?2022", re.I), ["db", "mssql", "mssql-2022"]),
    (re.compile(r"(?:Microsoft[_ ]?)?SQL[_ ]?Server[_ ]?2019", re.I), ["db", "mssql", "mssql-2019"]),
    (re.compile(r"(?:Microsoft[_ ]?)?SQL[_ ]?Server", re.I),       ["db", "mssql"]),
    # Postgres / MySQL
    (re.compile(r"PostgreSQL[_ ]?16", re.I),                       ["db", "postgres", "postgres-16"]),
    (re.compile(r"PostgreSQL[_ ]?15", re.I),                       ["db", "postgres", "postgres-15"]),
    (re.compile(r"PostgreSQL", re.I),                              ["db", "postgres"]),
    (re.compile(r"MySQL[_ ]?8", re.I),                             ["db", "mysql", "mysql-8.0"]),
    (re.compile(r"MySQL", re.I),                                   ["db", "mysql"]),
    # Cloud
    (re.compile(r"Amazon[_ ]?Web[_ ]?Services|\bAWS[_ ]?Foundations", re.I), ["cloud", "aws-account"]),
    (re.compile(r"\bMicrosoft[_ ]?Azure|\bAzure[_ ]?Foundations", re.I),     ["cloud", "azure-account"]),
    (re.compile(r"Google[_ ]?Cloud|\bGCP[_ ]?Foundation", re.I),             ["cloud", "gcp-account"]),
    # Container
    (re.compile(r"Kubernetes", re.I),                              ["container", "kubernetes"]),
    (re.compile(r"\bDocker\b", re.I),                              ["container", "docker"]),
    # macOS
    (re.compile(r"Apple[_ ]?macOS|\bmacOS[_ ]?\d+|\bMac[_ ]?OS[_ ]?X", re.I), ["macos"]),
]


def derive_os_keys(benchmark: str) -> list[str]:
    """Return the normalized_key list for a benchmark name. Empty if no match."""
    if not benchmark:
        return []
    for pattern, keys in _BENCHMARK_RULES:
        if pattern.search(benchmark):
            return keys
    return []


# ─── Driver ────────────────────────────────────────────────────────────

master = SessionLocal()
try:
    tenants = master.query(Tenant).all()
finally:
    master.close()

logger.info("Seeding %d tenants", len(tenants))
total_seeded = 0
total_backfilled = 0

for t in tenants:
    slug = getattr(t, "slug", None)
    if not slug:
        continue
    try:
        sess = open_tenant_session(slug)
    except Exception as e:
        logger.error("Could not open session for %s: %s", slug, e)
        continue
    try:
        # A) Seed grc_os_versions. Use INSERT ... ON CONFLICT DO NOTHING
        # so re-running is idempotent.
        seeded = 0
        for row in OS_SEED:
            (family, product, build, normalized_key, parent_key, display_name,
             release_year, eol_year, is_supported, benchmark_hint) = row
            result = sess.execute(text("""
                INSERT INTO grc_os_versions
                  (family, product, build, normalized_key, parent_key, display_name,
                   release_year, eol_year, is_supported, benchmark_hint)
                VALUES (:family, :product, :build, :normalized_key, :parent_key, :display_name,
                        :release_year, :eol_year, :is_supported, :benchmark_hint)
                ON CONFLICT (normalized_key) DO NOTHING
            """), {
                "family": family, "product": product, "build": build,
                "normalized_key": normalized_key, "parent_key": parent_key,
                "display_name": display_name, "release_year": release_year,
                "eol_year": eol_year, "is_supported": is_supported,
                "benchmark_hint": benchmark_hint,
            })
            seeded += result.rowcount or 0
        sess.commit()
        total_seeded += seeded

        # B) Backfill os_keys on plugins where it's still empty.
        # Postgres `json` type has no equality operator, so cast to text
        # for the empty-array check.
        plugins = sess.execute(text("""
            SELECT id, benchmark FROM grc_compliance_plugins
            WHERE benchmark IS NOT NULL
              AND (os_keys IS NULL OR os_keys::text = '[]')
        """)).all()
        backfilled = 0
        import json as _json
        for plugin_id, benchmark in plugins:
            keys = derive_os_keys(benchmark)
            if not keys:
                continue
            sess.execute(text(
                "UPDATE grc_compliance_plugins SET os_keys = CAST(:keys AS json), "
                "classification_source = 'regex', classified_at = NOW() WHERE id = :pid"
            ), {"keys": _json.dumps(keys), "pid": plugin_id})
            backfilled += 1
        sess.commit()
        total_backfilled += backfilled
        logger.info("  tenant=%-25s  seeded_os_versions=%3d  backfilled_plugins=%5d", slug, seeded, backfilled)
    except Exception as e:
        logger.error("  tenant=%s ERROR: %s", slug, e)
        sess.rollback()
    finally:
        sess.close()

logger.info("Done. total_os_versions_seeded=%d  total_plugins_backfilled=%d", total_seeded, total_backfilled)
