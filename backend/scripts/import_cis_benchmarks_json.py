"""Import the parsed CIS Benchmark JSON corpus into ``grc_compliance_plugins``.

The corpus (``CIS_Benchmarks/*.json``) is 497 CIS PDFs parsed into JSON —
~53k recommendations across 9 categories. This importer loads the relevant
CIS rules into the SAME schema the existing executable library uses, so the
existing library-tree UI ("show / apply / test rules against assets") renders
them unchanged.

Design (per product decisions):
  • Categories: CIS only — Cloud Providers, Desktop Software, DevSecOps Tools,
    Mobile Devices, Network Devices, Operating Systems, Server Software.
    (DISA STIG + Uncategorized are excluded — different standard / noise.)
  • Gap-fill: the existing library already ships executable Windows/Linux
    benchmarks. For the Operating Systems category we SKIP a new benchmark
    when it duplicates an existing one (Jaccard >= 0.85 on a normalised
    product+version signature). All other categories are new coverage.
  • Testing: these rules carry audit/remediation as TEXT (no executable
    check), so they are seeded as ``runner_type='manual'`` (attestation —
    operator records pass/fail/NA via the same run UI; see the ``manual``
    runner in compliance_plugins/runners/).
  • Grouping: each rule gets ``os_keys=[family, product_key]``; the importer
    then (re)builds ``grc_os_versions`` from every distinct os_keys array in
    the table so the library tree groups family -> product -> benchmark for
    BOTH the new rules and the pre-existing ones (which were previously
    orphaned because grc_os_versions was empty).

Rows are inserted as GLOBAL (``tenant_id IS NULL``), idempotent on
``(tenant_id, plugin_key)``. Run per tenant (or ``--all-tenants``); new
tenants inherit via ``sync_global_plugins_from_source`` at provisioning.

Usage:
    python -m scripts.import_cis_benchmarks_json --tenant layeronon --dry-run
    python -m scripts.import_cis_benchmarks_json --tenant layeronon
    python -m scripts.import_cis_benchmarks_json --all-tenants
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from grc.db import open_tenant_session  # noqa: E402
from grc.models import CompliancePlugin, OsVersion, Tenant, SessionLocal  # noqa: E402

# ── Configuration ────────────────────────────────────────────────────────────
DEFAULT_CIS_DIR = os.environ.get(
    "CIS_BENCHMARKS_DIR",
    r"C:\Users\Admin\Documents\GRC-Tenant\CIS_Benchmarks",
)

# CIS-only categories -> source file. DISA STIG + Uncategorized intentionally omitted.
CATEGORY_FILES: Dict[str, str] = {
    "Cloud Providers": "Cloud_Providers.json",
    "Desktop Software": "Desktop_Software.json",
    "DevSecOps Tools": "DevSecOps_Tools.json",
    "Mobile Devices": "Mobile_Devices.json",
    "Network Devices": "Network_Devices.json",
    "Operating Systems": "Operating_Systems.json",
    "Server Software": "Server_Software.json",
}

# Non-OS category -> grouping family. (Operating Systems is split by product.)
CATEGORY_FAMILY: Dict[str, str] = {
    "Cloud Providers": "cloud",
    "Desktop Software": "desktop",
    "DevSecOps Tools": "devsecops",
    "Mobile Devices": "mobile",
    "Network Devices": "network",
    "Server Software": "server",
}

# Pretty display labels for normalized_key segments (else title-cased).
_ACRONYMS = {
    "aws": "AWS", "gcp": "GCP", "ios": "iOS", "ipados": "iPadOS", "nx": "NX",
    "os": "OS", "db": "DB", "db2": "Db2", "macos": "macOS", "rhel": "RHEL",
    "aix": "AIX", "ibm": "IBM", "iis": "IIS", "sql": "SQL", "mysql": "MySQL",
    "postgresql": "PostgreSQL", "vmware": "VMware", "opnsense": "OPNsense",
    "freebsd": "FreeBSD", "chromeos": "ChromeOS", "k8s": "K8s", "hpe": "HPE",
    "oci": "OCI", "vms": "VMs", "ros": "ROS", "lxd": "LXD", "racf": "RACF",
}

_SIG_STOP = set(
    "cis benchmark archive enterprise member level profile l1 l2 the for and non r2 "
    "lts ltsb ltsc edition imported with bare metal foundation foundations services "
    "service stand alone standalone workstation".split()
)


# ── Helpers ──────────────────────────────────────────────────────────────────
def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9.]+", "-", (text or "").lower()).strip("-")


def prettify(key: str, family: str) -> str:
    """Human label for an os_versions node from its normalized_key.

    New product keys are namespaced ``family::subcategory-slug`` — we display
    the part after ``::`` (the raw subcategory, no redundant family word).
    Legacy keys (e.g. ``windows-11``, ``ubuntu-24.04``) are prettified whole
    so they read ``Windows 11`` / ``Ubuntu 24.04``."""
    core = key.split("::", 1)[1] if "::" in key else key
    words = [w for w in re.split(r"[-_]", core) if w]
    out: List[str] = []
    for w in words:
        if w in _ACRONYMS:
            out.append(_ACRONYMS[w])
        elif re.match(r"^\d", w):           # version token (11, 24.04, 2022)
            out.append(w)
        else:
            out.append(w.capitalize())
    return " ".join(out) or key


def family_label(fam: str) -> str:
    labels = {
        "windows": "Windows", "linux": "Linux", "cisco": "Cisco",
        "cloud": "Cloud", "db": "Databases", "macos": "macOS", "unix": "Unix",
        "network": "Network Devices", "mobile": "Mobile Devices",
        "desktop": "Desktop Software", "devsecops": "DevSecOps Tools",
        "server": "Server Software", "os": "Operating Systems",
    }
    return labels.get(fam, fam.title())


def os_family(subcategory: str) -> str:
    s = (subcategory or "").lower()
    if "windows" in s:
        return "windows"
    if "macos" in s or "apple" in s or "osx" in s:
        return "macos"
    if any(k in s for k in (
        "ubuntu", "debian", "red hat", "redhat", "rhel", "centos", "suse",
        "oracle linux", "amazon linux", "rocky", "almalinux", "alma", "fedora",
        "mint", "bottlerocket", "azure linux", "aliyun", "alibaba cloud linux",
        "linux",
    )):
        return "linux"
    if any(k in s for k in ("aix", "solaris", "freebsd", "z_os", "zos", "ibm i", "hp-ux", "unix")):
        return "unix"
    return "os"


def classify(category: str, subcategory: str) -> Tuple[str, str]:
    """Return (family, product_key) for grouping."""
    if category == "Operating Systems":
        fam = os_family(subcategory)
    else:
        fam = CATEGORY_FAMILY[category]
    # Namespace the product key with the family so two subcategories named the
    # same in different families (e.g. "Cisco" under network) never collide,
    # while prettify() still shows just the clean subcategory label.
    return fam, f"{fam}::{slug(subcategory)}"


def sig(name: str) -> frozenset:
    """Normalised product+version signature for dedup against existing benchmarks."""
    name = (name or "").replace("_", " ").replace("-", " ").lower()
    out = set()
    for tok in re.findall(r"[a-z0-9.]+", name):
        if re.fullmatch(r"v\d+(\.\d+)*", tok):      # CIS doc version (v3.0.0)
            continue
        if tok in _SIG_STOP:
            continue
        if len(tok) < 2 and not tok.isdigit():      # keep single-digit OS versions
            continue
        out.add(tok)
    return frozenset(out)


def jaccard(a: frozenset, b: frozenset) -> float:
    return len(a & b) / len(a | b) if (a or b) else 0.0


def textify(value: Any) -> Optional[str]:
    """Flatten a recommendation field (str | dict | list) to readable text."""
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list):
        parts = [textify(v) for v in value]
        joined = "\n".join(p for p in parts if p)
        return joined.strip() or None
    if isinstance(value, dict):
        parts = []
        for k, v in value.items():
            body = textify(v)
            if not body:
                continue
            label = "" if str(k).startswith("_") else f"{k}:\n"
            parts.append(f"{label}{body}".strip())
        return "\n\n".join(parts) or None
    return str(value)


def profile_level(rec: Dict[str, Any]) -> Optional[str]:
    p = str(rec.get("Profile Applicability") or "").lower()
    has1, has2 = "level 1" in p, "level 2" in p
    if has1 and not has2:
        return "L1"
    if has2 and not has1:
        return "L2"
    return None


def collect_references(rec: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    for field in ("References", "CIS Controls", "Additional Information"):
        t = textify(rec.get(field))
        if t:
            out.append(t if len(t) <= 2000 else t[:2000])
    return out


def iter_leaves(nodes: Iterable[Dict[str, Any]]) -> Iterable[Dict[str, Any]]:
    for n in nodes or []:
        if isinstance(n, dict):
            if n.get("type") == "recommendation":
                yield n
            yield from iter_leaves(n.get("children") or [])


def benchmark_code(name: str) -> str:
    code = re.sub(r"\s+", "_", (name or "").strip())
    code = re.sub(r"[^A-Za-z0-9._-]", "", code)
    return code[:90] or "CIS_Benchmark"


def clean_rule_id(raw: Any, fallback: int) -> str:
    rid = str(raw or "").strip()
    if not rid or len(rid) > 40 or not re.match(r"^[0-9A-Za-z][0-9A-Za-z.\-_ ]*$", rid):
        return f"R{fallback}"
    return rid[:40]


# ── Core import for one tenant ───────────────────────────────────────────────
def import_into_tenant(slug_name: str, cis_dir: str, categories: List[str],
                        dry_run: bool) -> Dict[str, int]:
    db = open_tenant_session(slug_name)
    stats = {"considered": 0, "skipped_dup": 0, "inserted": 0, "skipped_existing": 0,
             "benchmarks_kept": 0, "benchmarks_skipped": 0}
    try:
        # Existing benchmark signatures (for OS gap-fill dedup) + existing keys (idempotency)
        existing_benchmarks = [b for (b,) in db.query(CompliancePlugin.benchmark).distinct() if b]
        existing_sigs = [sig(b) for b in existing_benchmarks]
        existing_keys = {
            k for (k,) in db.query(CompliancePlugin.plugin_key)
            .filter(CompliancePlugin.tenant_id.is_(None)).all()
        }

        def is_os_duplicate(name: str) -> bool:
            ns = sig(name)
            if not ns:
                return False
            return any(jaccard(ns, es) >= 0.85 for es in existing_sigs)

        mappings: List[Dict[str, Any]] = []
        os_key_chains: set = set()
        now = datetime.utcnow()

        for category in categories:
            fn = CATEGORY_FILES[category]
            path = os.path.join(cis_dir, fn)
            if not os.path.exists(path):
                print(f"  ! missing file for {category}: {path}")
                continue
            import json
            with open(path, encoding="utf-8") as f:
                data = json.load(f)

            for bname, bench in data.items():
                if not isinstance(bench, dict):
                    continue
                name = bench.get("name") or bname
                subcategory = bench.get("subcategory") or name
                if category == "Operating Systems" and is_os_duplicate(name):
                    stats["benchmarks_skipped"] += 1
                    continue
                stats["benchmarks_kept"] += 1

                family, product_key = classify(category, subcategory)
                os_keys = [family, product_key]
                os_key_chains.add((family, product_key))
                code = benchmark_code(name)
                source_url = bench.get("source_url") or "https://www.cisecurity.org/cis-benchmarks"

                for idx, rec in enumerate(iter_leaves(bench.get("recommendations") or []), start=1):
                    stats["considered"] += 1
                    rule_id = clean_rule_id(rec.get("id"), idx)
                    plugin_key = f"{code}__{rule_id}"[:200]
                    if plugin_key in existing_keys:
                        stats["skipped_existing"] += 1
                        continue
                    existing_keys.add(plugin_key)  # dedup within this run too

                    title = (textify(rec.get("title")) or "Untitled recommendation")[:500]
                    mappings.append({
                        "tenant_id": None,
                        "plugin_key": plugin_key,
                        "benchmark": code[:100],
                        "rule_id": rule_id,
                        "title": title,
                        "description": textify(rec.get("Description")),
                        "rationale": textify(rec.get("Rationale")),
                        "remediation": textify(rec.get("Remediation")),
                        "severity": "medium",
                        "runner_type": "manual",
                        "check_definition": {"manual": True, "source": "cis_benchmark_pdf"},
                        "enabled": True,
                        "is_builtin": True,
                        "source_url": source_url[:500] if source_url else None,
                        "depth": 2,
                        "level": profile_level(rec),
                        "assessment_status": "approved",
                        "audit_steps_text": textify(rec.get("Audit")),
                        "references_json": collect_references(rec),
                        "cis_controls_json": [],
                        "mitre_techniques_json": [],
                        "review_status": "auto_approved",
                        "auto_generated_check": False,
                        "os_keys": os_keys,
                        "classification_source": "regex",
                        "classified_at": now,
                        "benchmark_version": None,
                        "target_builds": [],
                        "created_at": now,
                        "updated_at": now,
                    })

        stats["inserted"] = len(mappings)
        if dry_run:
            print(f"  [dry-run] {slug_name}: would insert {len(mappings)} rules "
                  f"({stats['benchmarks_kept']} benchmarks kept, "
                  f"{stats['benchmarks_skipped']} skipped as dup), "
                  f"{stats['skipped_existing']} already present")
            return stats

        # Bulk insert in chunks
        for i in range(0, len(mappings), 2000):
            db.bulk_insert_mappings(CompliancePlugin, mappings[i:i + 2000])
            db.commit()

        # (Re)build grc_os_versions from EVERY distinct os_keys array in the table
        # (covers the newly-imported rules AND the pre-existing executable rules).
        _rebuild_os_registry(db)
        db.commit()
        print(f"  {slug_name}: inserted {len(mappings)} rules, "
              f"{stats['benchmarks_kept']} benchmarks (skipped {stats['benchmarks_skipped']} dup, "
              f"{stats['skipped_existing']} already present)")
        return stats
    finally:
        db.close()


def _rebuild_os_registry(db) -> None:
    """Ensure a grc_os_versions node exists for every os_keys *product/build*
    segment, with parent_key chaining so the library tree groups
    family -> product -> build.

    The FIRST os_keys segment is the family (e.g. "linux") — that is rendered
    as a SYNTHETIC family node by the library-tree endpoint, so we must NOT
    create a registry node for it (doing so produces a redundant extra level
    "Linux -> Linux -> products"). Nodes therefore start at segment index 1
    (the product), which becomes a root (parent_key NULL) under its family.
    The registry is FULLY derived from os_keys, so we delete-and-rebuild for
    internal consistency (parent chains, no stale/dangling rows). This is safe:
    the library-tree grouping only needs family/normalized_key/parent_key/
    display_name/build, all of which are regenerated here."""
    db.query(OsVersion).delete()
    db.flush()

    existing: set = set()
    rows = db.query(CompliancePlugin.os_keys).filter(
        CompliancePlugin.os_keys.isnot(None)
    ).all()
    seen_chains = set()
    for (keys,) in rows:
        if not keys or not isinstance(keys, list):
            continue
        chain = tuple(str(k) for k in keys if k)
        if len(chain) < 2 or chain in seen_chains:
            continue
        seen_chains.add(chain)
        family = chain[0]
        # Create product (index 1) .. build (index 2+) nodes; skip family (0).
        for depth in range(1, len(chain)):
            key = chain[depth]
            if key in existing:
                continue
            existing.add(key)
            parent = chain[depth - 1] if depth >= 2 else None  # product is a root
            db.add(OsVersion(
                family=family,
                product=chain[1],
                build=chain[2] if len(chain) > 2 else None,
                normalized_key=key,
                parent_key=parent,
                display_name=prettify(key, family),
                is_supported=True,
            ))


def main() -> int:
    ap = argparse.ArgumentParser(description="Import CIS Benchmark JSON into grc_compliance_plugins")
    ap.add_argument("--tenant", help="Tenant slug to import into")
    ap.add_argument("--all-tenants", action="store_true", help="Import into every active tenant")
    ap.add_argument("--cis-dir", default=DEFAULT_CIS_DIR, help="Path to CIS_Benchmarks folder")
    ap.add_argument("--categories", nargs="*", default=list(CATEGORY_FILES.keys()),
                    help="Subset of categories to import")
    ap.add_argument("--dry-run", action="store_true", help="Report counts, write nothing")
    args = ap.parse_args()

    if not args.tenant and not args.all_tenants:
        ap.error("specify --tenant SLUG or --all-tenants")

    bad = [c for c in args.categories if c not in CATEGORY_FILES]
    if bad:
        ap.error(f"unknown categories: {bad}; valid: {list(CATEGORY_FILES)}")

    if args.all_tenants:
        m = SessionLocal()
        try:
            slugs = [t.slug for t in m.query(Tenant).all()
                     if getattr(t, "slug", None) and getattr(t, "is_active", True)]
        finally:
            m.close()
    else:
        slugs = [args.tenant]

    print(f"CIS import — categories={args.categories} dry_run={args.dry_run} tenants={slugs}")
    grand = 0
    for s in slugs:
        try:
            st = import_into_tenant(s, args.cis_dir, args.categories, args.dry_run)
            grand += st["inserted"]
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {s}: FAILED — {exc}")
    print(f"Done. total rules {'(planned)' if args.dry_run else 'inserted'}: {grand}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
