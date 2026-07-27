"""Benchmark version handling — DETECTION at ingest, PROMOTION on demand.

Design history
==============
v1 (replaced) auto-archived old benchmarks and auto-flipped OS→benchmark
mappings the moment a newer-version PDF was ingested. Hassan rejected
that as too aggressive for a bank:

  * production assets may be locked to v5.0.1 because an audit was
    performed against that version — silently flipping them to v5.0.2
    invalidates the audit trail
  * mixed estate may need v5.0.1 on some assets and v5.0.2 on others
    (e.g. lab pilot vs prod)
  * change-controlled assets may legally require an explicit promotion
    approval, not a side-effect of a developer dragging a PDF

v2 (current) splits the work in two:

  * ``detect_superseded_siblings`` — runs at ingest time, READ-ONLY.
    Identifies which benchmarks in the library are older/newer/same
    family as the new ingest, and how many active mapping rows currently
    point at each. Returns a structured summary the ingest log surfaces
    to the operator. Touches no rows.
  * ``promote_to_supersede`` — called manually by an operator from the
    admin UI when they decide to promote. Performs the actual rename
    (``<label>`` → ``<label>-ARCHIVE``) and mapping flip. This is the
    one-click "promote v5.0.1 → v5.0.2" button.

Architectural invariant remains: **one asset → exactly one active
benchmark per family**. The mapping table can still only name one
benchmark per OS pattern. What v2 changes is *who decides when* — the
operator, not the ingest pipeline.

The supersession function ``archive_superseded_benchmarks`` from v1 is
preserved below (now under the v2 name ``promote_to_supersede``) so the
test suite and any future admin endpoint can call it.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional, Tuple, List, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Matches the version suffix the ingest pipeline writes:
#   CIS_<family>_v<major>[.minor[.patch...]]
# Captures family + the dotted version string.
_LABEL_VERSION_RE = re.compile(r"^(?P<family>.+?)_v(?P<version>\d+(?:\.\d+)*)$")


@dataclass
class SupersessionResult:
    """Returned to the caller when an explicit promote runs."""

    new_label: str
    family: str
    new_version: Tuple[int, ...]
    archived_siblings: List[str] = field(default_factory=list)
    mapping_rows_repointed: int = 0
    rules_archived: int = 0
    skipped_downgrade_of: Optional[str] = None

    def to_log_entry(self) -> dict:
        return {
            "stage": "supersession",
            "new_label": self.new_label,
            "family": self.family,
            "new_version": ".".join(str(p) for p in self.new_version),
            "archived_siblings": self.archived_siblings,
            "mapping_rows_repointed": self.mapping_rows_repointed,
            "rules_archived": self.rules_archived,
            "skipped_downgrade_of": self.skipped_downgrade_of,
        }


def _parse_label(label: str) -> Optional[Tuple[str, Tuple[int, ...]]]:
    """Split ``CIS_Foo_Benchmark_v5.0.1`` into ``("CIS_Foo_Benchmark", (5,0,1))``.

    Returns None for labels that don't carry a parseable version suffix —
    those won't participate in supersession.
    """
    if not label or label.endswith("-ARCHIVE"):
        return None
    m = _LABEL_VERSION_RE.match(label)
    if not m:
        return None
    family = m.group("family")
    try:
        parts = tuple(int(p) for p in m.group("version").split("."))
    except ValueError:
        return None
    return family, parts


def _semver_cmp(a: Tuple[int, ...], b: Tuple[int, ...]) -> int:
    """Compare two semver tuples; returns -1/0/1. Pads with zeros."""
    n = max(len(a), len(b))
    pa = a + (0,) * (n - len(a))
    pb = b + (0,) * (n - len(b))
    if pa < pb:
        return -1
    if pa > pb:
        return 1
    return 0


def _tenant_scope_predicate(tenant_id: Optional[int]) -> Tuple[str, Dict[str, Any]]:
    """SQL fragment + params for "rules visible to this tenant" — same
    scope the strict matcher reads from. Globals + tenant-specific."""
    if tenant_id is None:
        return "tenant_id IS NULL", {}
    return "(tenant_id IS NULL OR tenant_id = :tenant_id)", {"tenant_id": tenant_id}


def detect_superseded_siblings(
    db: Session,
    new_label: str,
    *,
    tenant_id: Optional[int],
) -> Dict[str, Any]:
    """READ-ONLY. Identify family siblings of ``new_label`` already in the
    library and report how many active OS→benchmark mappings point at
    each.

    Returns a dict with the shape::

        {
            "family": "CIS_..._Benchmark",
            "new_version": "5.0.2",
            "older_siblings": [
                {"label": "..._v5.0.1", "version": "5.0.1",
                 "active_mapping_rows": 1, "applicable_assets_estimate": 21},
                ...
            ],
            "newer_siblings": [...],
            "active_mapping_rows": 0,   # rows currently pointing at new_label
        }

    Called from the ingest pipeline as Stage 5. NEVER mutates state.
    The ingest log surfaces this so the operator can decide whether to
    promote, leave as-is, or split the estate.
    """
    parsed = _parse_label(new_label)
    if parsed is None:
        return {
            "family": new_label,
            "new_version": None,
            "older_siblings": [],
            "newer_siblings": [],
            "active_mapping_rows": 0,
        }
    family, new_version = parsed
    where_tenant, tenant_params = _tenant_scope_predicate(tenant_id)

    sib_rows = db.execute(
        text(
            f"""
            SELECT DISTINCT benchmark
            FROM grc_compliance_plugins
            WHERE benchmark LIKE :family_prefix
              AND benchmark NOT LIKE '%-ARCHIVE'
              AND benchmark != :new_label
              AND {where_tenant}
            """
        ),
        {
            "family_prefix": family + "_v%",
            "new_label": new_label,
            **tenant_params,
        },
    ).fetchall()

    older: List[Dict[str, Any]] = []
    newer: List[Dict[str, Any]] = []
    for row in sib_rows:
        sib_label = row.benchmark
        sp = _parse_label(sib_label)
        if sp is None:
            continue
        _, sib_version = sp
        cmp = _semver_cmp(new_version, sib_version)

        # Count mapping rows pointing at this sibling.
        map_count = db.execute(
            text(
                "SELECT count(*) AS c FROM grc_benchmark_os_mappings "
                "WHERE benchmark_name = :b AND is_active = true"
            ),
            {"b": sib_label},
        ).scalar() or 0

        info = {
            "label": sib_label,
            "version": ".".join(str(p) for p in sib_version),
            "active_mapping_rows": int(map_count),
        }
        if cmp > 0:
            older.append(info)
        elif cmp < 0:
            newer.append(info)
        # cmp == 0 → same version with different label, ignore.

    new_label_map_count = db.execute(
        text(
            "SELECT count(*) AS c FROM grc_benchmark_os_mappings "
            "WHERE benchmark_name = :b AND is_active = true"
        ),
        {"b": new_label},
    ).scalar() or 0

    return {
        "family": family,
        "new_version": ".".join(str(p) for p in new_version),
        "older_siblings": older,
        "newer_siblings": newer,
        "active_mapping_rows": int(new_label_map_count),
    }


def promote_to_supersede(
    db: Session,
    new_label: str,
    *,
    tenant_id: Optional[int],
    only_promote_label: Optional[str] = None,
) -> SupersessionResult:
    """OPERATOR-DRIVEN promotion. Suffixes the older benchmark's rows
    with ``-ARCHIVE`` and re-points every active mapping that targets it
    to ``new_label`` instead.

    Wired to an admin endpoint, NOT to the ingest pipeline. The pipeline
    only DETECTS siblings (see ``detect_superseded_siblings``); promotion
    is an explicit operator decision.

    Args:
        new_label: the target benchmark to promote TO (must exist in DB).
        only_promote_label: if given, promote ONLY this specific older
            sibling (operator picked one). If None, promote every older
            sibling found in the same family — same as v1 behaviour.

    Returns a ``SupersessionResult`` summarising what changed. Safe to
    call when nothing matches (returns an empty result with no DB writes).
    """
    parsed = _parse_label(new_label)
    if parsed is None:
        return SupersessionResult(
            new_label=new_label, family=new_label, new_version=(),
        )
    family, new_version = parsed
    result = SupersessionResult(
        new_label=new_label,
        family=family,
        new_version=new_version,
    )

    where_tenant, tenant_params = _tenant_scope_predicate(tenant_id)
    siblings = db.execute(
        text(
            f"""
            SELECT DISTINCT benchmark
            FROM grc_compliance_plugins
            WHERE benchmark LIKE :family_prefix
              AND benchmark NOT LIKE '%-ARCHIVE'
              AND benchmark != :new_label
              AND {where_tenant}
            """
        ),
        {
            "family_prefix": family + "_v%",
            "new_label": new_label,
            **tenant_params,
        },
    ).fetchall()

    for row in siblings:
        sibling_label = row.benchmark
        if only_promote_label is not None and sibling_label != only_promote_label:
            continue
        sib_parsed = _parse_label(sibling_label)
        if sib_parsed is None:
            continue
        _, sib_version = sib_parsed
        cmp = _semver_cmp(new_version, sib_version)

        if cmp == 0:
            continue
        if cmp < 0:
            logger.warning(
                "supersession: refusing to downgrade — new=%s is older than existing=%s",
                new_label, sibling_label,
            )
            result.skipped_downgrade_of = sibling_label
            continue

        archive_label = sibling_label + "-ARCHIVE"
        archived = db.execute(
            text(
                """
                UPDATE grc_compliance_plugins
                SET benchmark = :archive_label,
                    plugin_key = REPLACE(plugin_key, :old_label || '__', :archive_label || '__'),
                    updated_at = now()
                WHERE benchmark = :old_label
                """
            ),
            {"old_label": sibling_label, "archive_label": archive_label},
        ).rowcount or 0
        result.rules_archived += archived

        repointed = db.execute(
            text(
                """
                UPDATE grc_benchmark_os_mappings
                SET benchmark_name = :new_label,
                    updated_at = now()
                WHERE benchmark_name = :old_label
                """
            ),
            {"new_label": new_label, "old_label": sibling_label},
        ).rowcount or 0
        result.mapping_rows_repointed += repointed
        result.archived_siblings.append(sibling_label)

        logger.info(
            "promote: %s → %s · rules archived=%d · mappings repointed=%d",
            sibling_label, new_label, archived, repointed,
        )

    db.commit()
    return result


# ─── Back-compat shim for the v1 callers + the existing test ─────────────
def archive_superseded_benchmarks(
    db: Session,
    new_label: str,
    *,
    tenant_id: Optional[int],
) -> SupersessionResult:
    """Deprecated alias for ``promote_to_supersede`` — kept so the
    existing test suite continues to exercise the actual archive+flip
    code path. New callers should use ``promote_to_supersede``."""
    return promote_to_supersede(db, new_label, tenant_id=tenant_id)
