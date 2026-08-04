"""Ensure Rule Library catalog nodes (`grc_os_versions`) match plugin os_keys.

The library tree attaches each benchmark to its most-specific os_keys leaf
(see compliance_plugins/router.py). If that leaf is missing from
grc_os_versions, the benchmark falls into "Other / unclassified".

Call ``ensure_catalog_nodes_for_keys`` / ``ensure_keys_from_benchmarks``
whenever authoring introduces a new engine/version — and run the library-wide
sweep (``scripts/ensure_os_catalog_nodes.py``) so every distinct leaf has a
node with the correct family/parent hierarchy.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional, Sequence

# ── Family roots (parent_key IS NULL) ───────────────────────────────────
FAMILY_ROOTS: dict[str, str] = {
    "windows": "Windows",
    "linux": "Linux",
    "macos": "macOS",
    "cisco": "Cisco",
    "cloud": "Cloud Accounts",
    "container": "Containers",
    "db": "Databases",
    "network": "Network",
    "app": "Applications",
    "unix": "Unix / Mainframe",
    "hypervisor": "Hypervisors",
    "endpoint": "Endpoints",
    "other": "Other",
}

# product_key → (family, parent_key, display_name)
# Versioned leaves ``{product}-{build}`` hang under the product node.
PRODUCTS: dict[str, tuple[str, str, str]] = {
    # Windows products that take builds (windows-11-21H2)
    "windows-11": ("windows", "windows", "Windows 11"),
    "windows-10": ("windows", "windows", "Windows 10"),
    # Linux distros
    "ubuntu": ("linux", "linux", "Ubuntu"),
    "debian": ("linux", "linux", "Debian"),
    "rhel": ("linux", "linux", "Red Hat Enterprise Linux"),
    "almalinux": ("linux", "linux", "AlmaLinux"),
    "rocky": ("linux", "linux", "Rocky Linux"),
    "oraclelinux": ("linux", "linux", "Oracle Linux"),
    "amazonlinux": ("linux", "linux", "Amazon Linux"),
    "alibaba-linux": ("linux", "linux", "Alibaba Cloud Linux"),
    "aliyun": ("linux", "linux", "Aliyun Linux"),
    "google-cos": ("linux", "linux", "Google Container-Optimized OS"),
    # macOS (product == family key; builds hang under macos)
    "macos": ("macos", "macos", "macOS"),
    # Cisco
    "cisco-ios": ("cisco", "cisco", "Cisco IOS"),
    "cisco-ios-xe": ("cisco", "cisco", "Cisco IOS-XE"),
    "cisco-ios-xr": ("cisco", "cisco", "Cisco IOS XR"),
    "cisco-nx-os": ("cisco", "cisco", "Cisco NX-OS"),
    "cisco-nxos": ("cisco", "cisco", "Cisco NX-OS"),
    "cisco-asa": ("cisco", "cisco", "Cisco ASA"),
    "cisco-firepower": ("cisco", "cisco", "Cisco Firepower"),
    "cisco-firewall": ("cisco", "cisco", "Cisco Firewall"),
    # Databases
    "postgresql": ("db", "db", "PostgreSQL"),
    "postgres": ("db", "db", "PostgreSQL"),
    "mysql": ("db", "db", "MySQL"),
    "mariadb": ("db", "db", "MariaDB"),
    "oracle-db": ("db", "db", "Oracle Database"),
    "mssql": ("db", "db", "Microsoft SQL Server"),
    "mongodb": ("db", "db", "MongoDB"),
    "cassandra": ("db", "db", "Cassandra"),
    "ibm-db2": ("db", "db", "IBM DB2"),
    "redis": ("db", "db", "Redis"),
    # Cloud
    "aws": ("cloud", "cloud", "AWS"),
    "aws-account": ("cloud", "cloud", "AWS Account"),
    "azure": ("cloud", "cloud", "Azure"),
    "azure-account": ("cloud", "cloud", "Azure Subscription"),
    "gcp": ("cloud", "cloud", "GCP"),
    "gcp-account": ("cloud", "cloud", "GCP Project"),
    "alibaba": ("cloud", "cloud", "Alibaba Cloud"),
    "aliyun-cloud": ("cloud", "cloud", "Aliyun"),
    "digitalocean": ("cloud", "cloud", "DigitalOcean"),
    "ibm-cloud": ("cloud", "cloud", "IBM Cloud"),
    "github": ("cloud", "cloud", "GitHub"),
    "microsoft-365": ("cloud", "cloud", "Microsoft 365"),
    "google-workspace": ("cloud", "cloud", "Google Workspace"),
    "oci": ("cloud", "cloud", "Oracle Cloud Infrastructure"),
    "oracle-saas": ("cloud", "cloud", "Oracle SaaS"),
    # Containers
    "kubernetes": ("container", "container", "Kubernetes"),
    "docker": ("container", "container", "Docker"),
    "openshift": ("container", "container", "OpenShift"),
    # Network (non-Cisco)
    "fortigate": ("network", "network", "FortiGate"),
    "juniper": ("network", "network", "Juniper"),
    "f5": ("network", "network", "F5"),
    "pfsense": ("network", "network", "pfSense"),
    "hpe-aruba": ("network", "network", "HPE Aruba"),
    "paloalto-panos": ("network", "network", "Palo Alto PAN-OS"),
    # Applications
    "tomcat": ("app", "app", "Apache Tomcat"),
    "apache-httpd": ("app", "app", "Apache HTTP Server"),
    "nginx": ("app", "app", "NGINX"),
    "iis": ("app", "app", "Microsoft IIS"),
    "websphere": ("app", "app", "IBM WebSphere"),
    "sharepoint": ("app", "app", "Microsoft SharePoint"),
    "microsoft-exchange": ("app", "app", "Microsoft Exchange"),
    # Unix / mainframe
    "ibm-zos": ("unix", "unix", "IBM z/OS"),
    "ibm-aix": ("unix", "unix", "IBM AIX"),
    "freebsd": ("unix", "unix", "FreeBSD"),
    "ibm-cics": ("unix", "unix", "IBM CICS"),
    "solaris": ("unix", "unix", "Oracle Solaris"),
    # Hypervisor
    "vmware-esxi": ("hypervisor", "hypervisor", "VMware ESXi"),
    "vmware-vcenter": ("hypervisor", "hypervisor", "VMware vCenter"),
    # Endpoints / legacy desktop
    "chromeos": ("endpoint", "endpoint", "ChromeOS"),
    "microsoft-defender": ("endpoint", "endpoint", "Microsoft Defender"),
    "windows-xp": ("windows", "windows", "Windows XP"),
}

# Exact leaf overrides (when prefix splitting would mis-parent).
# (family, parent_key, product, build, display_name)
EXACT: dict[str, tuple[str, str, str, Optional[str], str]] = {
    "windows-server-2025": ("windows", "windows", "windows-server-2025", None, "Windows Server 2025"),
    "windows-server-2022": ("windows", "windows", "windows-server-2022", None, "Windows Server 2022"),
    "windows-server-2019": ("windows", "windows", "windows-server-2019", None, "Windows Server 2019"),
    "windows-server-2016": ("windows", "windows", "windows-server-2016", None, "Windows Server 2016"),
    "windows-server-2012-r2": ("windows", "windows", "windows-server-2012-r2", None, "Windows Server 2012 R2"),
    "windows-server-2012": ("windows", "windows", "windows-server-2012", None, "Windows Server 2012"),
    "windows-server-2008-r2": ("windows", "windows", "windows-server-2008-r2", None, "Windows Server 2008 R2"),
    "windows-server-2008": ("windows", "windows", "windows-server-2008", None, "Windows Server 2008"),
    "windows-server-2003": ("windows", "windows", "windows-server-2003", None, "Windows Server 2003"),
    "windows-8": ("windows", "windows", "windows-8", None, "Windows 8 / 8.1"),
    "windows-8.1": ("windows", "windows", "windows-8.1", None, "Windows 8.1"),
    "windows-7": ("windows", "windows", "windows-7", None, "Windows 7"),
    "windows-xp": ("windows", "windows", "windows-xp", None, "Windows XP"),
    "kubernetes-aks": ("container", "kubernetes", "kubernetes", "aks", "Azure Kubernetes Service (AKS)"),
    "azure-aks": ("container", "kubernetes", "kubernetes", "aks", "Azure Kubernetes Service (AKS)"),
    "eks": ("container", "kubernetes", "kubernetes", "eks", "Amazon EKS"),
    "gke": ("container", "kubernetes", "kubernetes", "gke", "Google GKE"),
}


def _title_key(key: str) -> str:
    return key.replace("-", " ").replace("_", " ").title()


def _family_row(family: str) -> tuple:
    label = FAMILY_ROOTS.get(family, family.title())
    return (family, None, None, family, None, label)


def _product_row(product: str) -> Optional[tuple]:
    spec = PRODUCTS.get(product)
    if not spec:
        return None
    family, parent, label = spec
    # macOS product key equals family key — already covered by family root.
    if product == family:
        return None
    return (family, product, None, product, parent, label)


def _parse_leaf(leaf: str) -> list[tuple]:
    """Return ancestor rows (family → … → leaf) for a normalized key.

    Each row: (family, product, build, normalized_key, parent_key, display_name)
    """
    if not leaf or leaf.startswith("__"):
        return []

    rows: list[tuple] = []

    def add(row: tuple) -> None:
        rows.append(row)

    if leaf in FAMILY_ROOTS:
        add(_family_row(leaf))
        return rows

    if leaf in EXACT:
        family, parent, product, build, display = EXACT[leaf]
        add(_family_row(family))
        if parent and parent not in FAMILY_ROOTS and parent != leaf:
            # Intermediate product node (e.g. kubernetes under container for aks).
            prow = _product_row(parent)
            if prow:
                add(prow)
            elif parent in PRODUCTS:
                fam, par, lab = PRODUCTS[parent]
                add((fam, parent, None, parent, par, lab))
            else:
                add((family, parent, None, parent, family, _title_key(parent)))
        add((family, product, build, leaf, parent, display))
        return rows

    # Longest product-prefix match.
    for prefix in sorted(PRODUCTS.keys(), key=len, reverse=True):
        family, parent, label = PRODUCTS[prefix]
        if leaf == prefix:
            add(_family_row(family))
            prow = _product_row(prefix)
            if prow:
                add(prow)
            elif prefix == family:
                pass  # family root only
            return rows
        if leaf.startswith(prefix + "-"):
            build = leaf[len(prefix) + 1 :]
            add(_family_row(family))
            if prefix != family:
                prow = _product_row(prefix)
                if prow:
                    add(prow)
                parent_of_leaf = prefix
            else:
                # e.g. macos-15.0 → parent macos (family root)
                parent_of_leaf = family
            display = f"{label} {build}" if build else label
            # niceties
            if prefix == "mssql":
                display = f"MSSQL {build}"
            elif prefix == "oracle-db":
                display = f"Oracle DB {build}"
            elif prefix.startswith("windows-"):
                display = f"{label} — {build}"
            add((family, prefix if prefix != family else family, build, leaf, parent_of_leaf, display))
            return rows

    # windows-server-* catch-all (not in EXACT)
    m = re.match(r"^(windows-server-\d+(?:-r\d)?)$", leaf)
    if m:
        add(_family_row("windows"))
        add(("windows", leaf, None, leaf, "windows", _title_key(leaf)))
        return rows

    # Fallback: park under Other so the benchmark is visible, not orphaned.
    add(_family_row("other"))
    add(("other", leaf, None, leaf, "other", _title_key(leaf)))
    return rows


def ensure_catalog_nodes_for_keys(
    cur,
    keys: Iterable[str],
    *,
    overwrite: bool = False,
) -> list[str]:
    """Idempotent insert of grc_os_versions rows for the given keys.

    Ensures family + product ancestors. By default does NOT overwrite existing
    rows (hand-tuned catalog stays intact). Set overwrite=True to refresh
    parent/display for keys you own (e.g. newly authored DB engines).
    """
    wanted: list[tuple] = []
    seen: set[str] = set()

    for leaf in keys:
        if not leaf:
            continue
        for row in _parse_leaf(leaf):
            key = row[3]
            if key in seen:
                continue
            seen.add(key)
            wanted.append(row)

    if not wanted:
        return []

    inserted: list[str] = []
    for family, product, build, normalized_key, parent_key, display_name in wanted:
        if overwrite:
            cur.execute(
                """
                INSERT INTO grc_os_versions
                  (family, product, build, normalized_key, parent_key, display_name,
                   is_supported, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                ON CONFLICT (normalized_key) DO UPDATE
                  SET parent_key = EXCLUDED.parent_key,
                      display_name = EXCLUDED.display_name,
                      product = EXCLUDED.product,
                      build = EXCLUDED.build,
                      family = EXCLUDED.family,
                      is_supported = TRUE,
                      updated_at = NOW()
                RETURNING (xmax = 0) AS was_insert, normalized_key
                """,
                (family, product, build, normalized_key, parent_key, display_name),
            )
            row = cur.fetchone()
            if row and row[0]:
                inserted.append(row[1])
        else:
            cur.execute(
                """
                INSERT INTO grc_os_versions
                  (family, product, build, normalized_key, parent_key, display_name,
                   is_supported, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                ON CONFLICT (normalized_key) DO NOTHING
                RETURNING normalized_key
                """,
                (family, product, build, normalized_key, parent_key, display_name),
            )
            row = cur.fetchone()
            if row:
                inserted.append(row[0])
    return inserted


def ensure_db_engine_nodes(
    cur,
    *,
    product: str,
    builds: Sequence[str],
) -> list[str]:
    """Convenience: ensure product root + each ``{product}-{build}`` node."""
    keys = [product] + [f"{product}-{b}" for b in builds]
    return ensure_catalog_nodes_for_keys(cur, keys, overwrite=True)


def ensure_keys_from_benchmarks(
    cur,
    benchmarks: Sequence[str] | None = None,
    *,
    overwrite: bool = False,
) -> dict:
    """Scan plugin os_keys (all elements) and ensure catalog nodes exist."""
    if benchmarks:
        cur.execute(
            """
            SELECT DISTINCT jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(CAST(os_keys AS jsonb)) = 'array'
                   THEN CAST(os_keys AS jsonb) ELSE '[]'::jsonb END
            ) AS key
            FROM grc_compliance_plugins
            WHERE benchmark = ANY(%s)
            """,
            (list(benchmarks),),
        )
    else:
        cur.execute(
            """
            SELECT DISTINCT jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(CAST(os_keys AS jsonb)) = 'array'
                   THEN CAST(os_keys AS jsonb) ELSE '[]'::jsonb END
            ) AS key
            FROM grc_compliance_plugins
            WHERE os_keys IS NOT NULL
            """
        )
    leaves = [r[0] for r in cur.fetchall() if r[0]]
    inserted = ensure_catalog_nodes_for_keys(cur, leaves, overwrite=overwrite)
    return {"leaves": leaves, "inserted": inserted}
