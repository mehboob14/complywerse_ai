"""
Asset → Framework-control mapping recommender.

Given an ITAsset, scan every FrameworkControl in the tenant and score each one
on how likely it applies to this asset. Pure regex over the control text — no
LLM, no external calls, deterministic.

Scoring model — each "signal" matched contributes a fixed weight (matched at
most once per control). Total score = sum of matched signal weights. Confidence
buckets are derived from the total:
    >= 8  high
    >= 4  medium
    >= 2  low
    <  2  hidden by default (operator can opt in)

The signal library is grounded in real seed text (NIST CSF / CIS / PCI / ISO).
When tuning, prefer adding new signals over editing existing weights — drift in
weights compounds across the matrix.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session, joinedload

from ..models import (
    AssetFrameworkControlLink,
    ControlObjective,
    Framework,
    FrameworkControl,
    FrameworkDomain,
    ITAsset,
)


# ─── Signal library ──────────────────────────────────────────────────────────
#
# A signal is "this asset attribute is mentioned in the control text". Each
# signal has:
#   - key:     stable identifier surfaced to the UI (chip label)
#   - label:   human display string
#   - weight:  contribution to the total score
#   - pattern: compiled regex run against the lowercased control blob
#   - applies: predicate(asset) -> bool. The signal only fires when BOTH the
#              pattern matches AND the asset is the kind of thing the signal
#              cares about. Without the predicate gate we'd recommend "Linux
#              hardening" controls to a Windows asset just because the control
#              mentions Linux once in a list.

@dataclass(frozen=True)
class Signal:
    key: str
    label: str
    weight: int
    pattern: re.Pattern
    applies: Callable[["ITAsset"], bool]


def _re(*alternatives: str) -> re.Pattern:
    return re.compile(r"\b(?:" + "|".join(alternatives) + r")\b", re.IGNORECASE)


def _norm(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _is_cloud(asset: ITAsset) -> bool:
    return _norm(asset.asset_type) == "cloud" or bool(
        re.search(r"cloud|aws|azure|gcp", _norm(asset.vendor) + " " + _norm(asset.name))
    )


def _is_internet_facing(asset: ITAsset) -> bool:
    return bool(getattr(asset, "internet_facing", False)) or _norm(asset.network_segment) in {
        "dmz", "edge", "public", "perimeter", "external",
    }


def _has_sensitive_data(asset: ITAsset) -> bool:
    dc = _norm(asset.data_classification)
    if dc in {"confidential", "restricted"}:
        return True
    scope = asset.compliance_scope or []
    if isinstance(scope, (list, tuple)) and any(
        str(s).upper() in {"PCI-DSS", "HIPAA", "GDPR", "PII", "PHI", "SOX"} for s in scope
    ):
        return True
    return False


def _is_critical(asset: ITAsset) -> bool:
    return _norm(asset.criticality) in {"high", "critical"}


def _business_function_contains(*needles: str) -> Callable[[ITAsset], bool]:
    def _check(asset: ITAsset) -> bool:
        bf = _norm(asset.business_function)
        return any(n in bf for n in needles) if bf else False
    return _check


def _vendor_contains(*needles: str) -> Callable[[ITAsset], bool]:
    def _check(asset: ITAsset) -> bool:
        v = _norm(asset.vendor)
        return any(n in v for n in needles) if v else False
    return _check


# OS family patterns share a single regex per family so we can also test for
# negative-evidence: e.g. don't recommend a control that ONLY names Linux to a
# Windows asset.
_WIN_PATTERN = _re(
    r"windows", r"microsoft\s+windows", r"win\s?(?:7|8|10|11)",
    r"server\s?20(?:08|12|16|19|22)", r"active\s+directory", r"powershell",
    r"\.net\s+framework", r"sccm", r"intune",
)
_LINUX_PATTERN = _re(
    r"linux", r"ubuntu", r"red\s?hat", r"rhel", r"centos", r"debian",
    r"suse", r"oracle\s+linux", r"amazon\s+linux", r"kernel",
    r"systemd", r"bash",
)
_MACOS_PATTERN = _re(r"macos", r"mac\s*os", r"osx", r"darwin")


SIGNALS: Sequence[Signal] = (
    # ── OS — highest signal (weight 5) ───────────────────────────────────────
    Signal(
        key="os_windows",
        label="Windows",
        weight=5,
        pattern=_WIN_PATTERN,
        applies=lambda a: _norm(a.os_family) == "windows",
    ),
    Signal(
        key="os_linux",
        label="Linux",
        weight=5,
        pattern=_LINUX_PATTERN,
        applies=lambda a: _norm(a.os_family) == "linux",
    ),
    Signal(
        key="os_macos",
        label="macOS",
        weight=5,
        pattern=_MACOS_PATTERN,
        applies=lambda a: _norm(a.os_family) == "macos",
    ),

    # ── Asset-type signals (weight 4) ────────────────────────────────────────
    Signal(
        key="type_server",
        label="Servers",
        weight=4,
        pattern=_re(
            r"server", r"workstation", r"host", r"virtual\s+machine",
            r"\bvm\b", r"hypervisor", r"bare[-\s]?metal", r"compute\s+node",
        ),
        applies=lambda a: _norm(a.asset_type) in {"infrastructure", "application"},
    ),
    Signal(
        key="type_endpoint",
        label="Endpoint devices",
        weight=4,
        pattern=_re(
            r"endpoint", r"laptop", r"desktop", r"user\s+device",
            r"mobile\s+device", r"\bbyod\b", r"workstation",
        ),
        applies=lambda a: _norm(a.asset_type) in {"infrastructure"},
    ),
    Signal(
        key="type_network",
        label="Network device",
        weight=4,
        pattern=_re(
            r"firewall", r"router", r"switch", r"load[-\s]?balanc(?:er|ing)",
            r"gateway", r"proxy", r"\bvpn\b", r"vpn\s+concentrator",
            r"wireless\s+access", r"\bwifi\b", r"wlan",
        ),
        applies=lambda a: _norm(a.network_segment) != ""
        or _vendor_contains("cisco", "juniper", "fortinet", "palo alto")(a),
    ),
    Signal(
        key="type_database",
        label="Database",
        weight=4,
        pattern=_re(
            r"database", r"\bdbms\b", r"sql\s+server", r"oracle\s+db",
            r"postgres", r"\bmysql\b", r"mongodb", r"nosql", r"data\s+store",
            r"data\s+warehouse",
        ),
        applies=lambda a: _norm(a.asset_type) == "data"
        or _business_function_contains("database", "data warehouse")(a),
    ),
    Signal(
        key="type_web_application",
        label="Web/application",
        weight=4,
        pattern=_re(
            r"web\s+application", r"web\s+server", r"\bapi\b",
            r"microservice", r"application\s+server", r"web\s+service",
            r"\brest\b", r"\bgraphql\b",
        ),
        applies=lambda a: _norm(a.asset_type) == "application",
    ),
    Signal(
        key="type_cloud",
        label="Cloud workload",
        weight=4,
        pattern=_re(
            r"cloud(?:\s+service|\s+workload)?", r"\baws\b", r"\bazure\b",
            r"\bgcp\b", r"google\s+cloud", r"\biaas\b", r"\bpaas\b",
            r"\bsaas\b", r"kubernetes", r"\bk8s\b", r"container",
            r"serverless",
        ),
        applies=_is_cloud,
    ),
    Signal(
        key="type_iot_ot",
        label="IoT / OT",
        weight=4,
        pattern=_re(
            r"\biot\b", r"industrial\s+control", r"\bscada\b",
            r"operational\s+technology", r"\bot\s+system", r"\bics\b",
        ),
        applies=lambda a: _norm(a.asset_type) == "infrastructure"
        and _business_function_contains("ot", "industrial", "scada", "iot")(a),
    ),

    # ── Network exposure (weight 3) ──────────────────────────────────────────
    Signal(
        key="exposure_internet_facing",
        label="Internet-facing",
        weight=3,
        pattern=_re(
            r"internet[-\s]?facing", r"public[-\s]?facing", r"external\s+network",
            r"\bdmz\b", r"edge\s+network", r"exposed\s+to\s+the\s+internet",
            r"perimeter", r"north[-\s]?south", r"public\s+endpoint",
        ),
        applies=_is_internet_facing,
    ),

    # ── Data sensitivity (weight 3) ──────────────────────────────────────────
    Signal(
        key="data_sensitive",
        label="Sensitive data",
        weight=3,
        pattern=_re(
            r"sensitive\s+data", r"confidential\s+data", r"restricted\s+data",
            r"personal\s+data", r"personally\s+identifiable", r"\bpii\b",
            r"\bphi\b", r"cardholder", r"payment\s+card", r"pci\s+data",
            r"financial\s+data", r"protected\s+health", r"\bgdpr\b",
            r"data\s+at\s+rest", r"data\s+in\s+transit",
        ),
        applies=_has_sensitive_data,
    ),

    # ── Criticality (weight 2) ───────────────────────────────────────────────
    Signal(
        key="criticality_high",
        label="Critical system",
        weight=2,
        pattern=_re(
            r"critical\s+(?:system|asset|service|infrastructure)",
            r"business[-\s]?critical", r"mission[-\s]?critical",
            r"high[-\s]?value", r"tier[-\s]?1", r"tier[-\s]?one",
            r"essential\s+service",
        ),
        applies=_is_critical,
    ),

    # ── Business-function-specific (weight 3) ────────────────────────────────
    Signal(
        key="function_payments",
        label="Payments",
        weight=3,
        pattern=_re(
            r"payment", r"cardholder", r"\bpos\s*system", r"merchant",
            r"acquirer", r"\bswift\b", r"\bach\b", r"payment\s+processor",
        ),
        applies=_business_function_contains("payment", "card", "pos", "merchant"),
    ),
    Signal(
        key="function_email",
        label="Email / Messaging",
        weight=3,
        pattern=_re(
            r"\bemail\b", r"mail\s+server", r"\bsmtp\b", r"\bimap\b",
            r"messaging\s+server", r"\bexchange\b", r"mail\s+relay",
        ),
        applies=_business_function_contains("email", "mail", "messag", "exchange"),
    ),
    Signal(
        key="function_identity",
        label="Identity / Auth",
        weight=3,
        pattern=_re(
            r"identity", r"directory\s+service", r"active\s+directory",
            r"\bldap\b", r"\bsaml\b", r"\bsso\b", r"federation",
            r"\biam\b", r"oauth", r"\boidc\b",
        ),
        applies=_business_function_contains("identity", "auth", "iam", "directory", "sso"),
    ),
    Signal(
        key="function_backup",
        label="Backup / DR",
        weight=3,
        pattern=_re(
            r"backup", r"restore", r"disaster\s+recovery", r"business\s+continuity",
            r"\brpo\b", r"\brto\b", r"replication",
        ),
        applies=_business_function_contains("backup", "recovery", "continuity", "dr"),
    ),

    # ── Vendor signals (weight 2) ────────────────────────────────────────────
    Signal(
        key="vendor_microsoft",
        label="Microsoft",
        weight=2,
        pattern=_re(r"microsoft", r"azure", r"active\s+directory"),
        applies=_vendor_contains("microsoft"),
    ),
    Signal(
        key="vendor_redhat",
        label="Red Hat",
        weight=2,
        pattern=_re(r"red\s?hat", r"rhel"),
        applies=_vendor_contains("red hat", "redhat"),
    ),
    Signal(
        key="vendor_cisco",
        label="Cisco",
        weight=2,
        pattern=_re(r"cisco"),
        applies=_vendor_contains("cisco"),
    ),
    Signal(
        key="vendor_oracle",
        label="Oracle",
        weight=2,
        pattern=_re(r"oracle"),
        applies=_vendor_contains("oracle"),
    ),
    Signal(
        key="vendor_aws",
        label="AWS",
        weight=2,
        pattern=_re(r"\baws\b", r"amazon\s+web\s+services"),
        applies=_vendor_contains("aws", "amazon"),
    ),

    # ── Universal "applies to all assets" (weight 1) ─────────────────────────
    # Catches CSF ID.AM-1 type controls that explicitly say "all assets" /
    # "every device". Low weight so they don't drown out specific matches.
    Signal(
        key="universal_inventory",
        label="All assets",
        weight=1,
        pattern=_re(
            r"all\s+(?:systems|assets|devices|endpoints|hardware|software)",
            r"every\s+(?:system|asset|device)",
            r"enterprise\s+(?:asset|inventory)",
            r"\binventory\b",
            r"all\s+information\s+assets",
        ),
        applies=lambda _a: True,
    ),
)


# ─── Negative-evidence filters ───────────────────────────────────────────────
# Some controls explicitly scope themselves to one OS family or to the cloud /
# physical-data-center axis. If we detect a strong scope signal AGAINST the
# current asset, reduce the total score so the rec drops out of "high" /
# "medium" bands without disappearing entirely (operator can still opt in via
# the show-all-scores toggle).

_PHYSICAL_FACILITY_PATTERN = re.compile(
    r"\b(?:physical\s+access|facility|datacenter|data\s+center|server\s+room|cabling)\b",
    re.IGNORECASE,
)


def _negative_evidence_penalty(asset: ITAsset, blob: str) -> Tuple[int, List[str]]:
    """Return (penalty_points, notes). Penalty is subtracted from the total."""
    penalty = 0
    notes: List[str] = []
    fam = _norm(asset.os_family)

    # OS-mismatch: control mentions ONLY a different family.
    if fam == "windows" and _LINUX_PATTERN.search(blob) and not _WIN_PATTERN.search(blob):
        penalty += 4
        notes.append("control scoped to Linux")
    if fam == "linux" and _WIN_PATTERN.search(blob) and not _LINUX_PATTERN.search(blob):
        penalty += 4
        notes.append("control scoped to Windows")
    if fam == "macos" and (
        _WIN_PATTERN.search(blob) or _LINUX_PATTERN.search(blob)
    ) and not _MACOS_PATTERN.search(blob):
        penalty += 3
        notes.append("control scoped to non-macOS")

    # Cloud vs physical facility mismatch.
    if _is_cloud(asset) and _PHYSICAL_FACILITY_PATTERN.search(blob):
        penalty += 2
        notes.append("physical-facility scope (asset is cloud)")

    return penalty, notes


# ─── Scoring ─────────────────────────────────────────────────────────────────

@dataclass
class MatchedSignal:
    key: str
    label: str
    weight: int


@dataclass
class RecommendationScore:
    framework_control_id: int
    framework_id: Optional[int]
    framework_name: Optional[str]
    framework_short_code: Optional[str]
    code: str
    name: str
    statement: Optional[str]
    score: int
    confidence: str  # "high" | "medium" | "low"
    matched_signals: List[MatchedSignal]
    negative_notes: List[str]


def _bucket(score: int) -> str:
    if score >= 8:
        return "high"
    if score >= 4:
        return "medium"
    return "low"


def _control_blob(control: FrameworkControl) -> str:
    parts = [
        control.name or "",
        control.statement or "",
        control.control_objective or "",
        control.implementation_guidance or "",
        control.testing_guidance or "",
    ]
    return " ".join(p for p in parts if p).lower()


def score_control_for_asset(
    asset: ITAsset, control: FrameworkControl, blob: Optional[str] = None
) -> Tuple[int, List[MatchedSignal], List[str]]:
    """Return (score, matched_signals, negative_notes) for one (asset, control).

    Pure function — no DB access. Pass `blob` to skip re-concatenating control
    text when scoring many controls in a hot loop.
    """
    if blob is None:
        blob = _control_blob(control)
    if not blob:
        return 0, [], []

    matched: List[MatchedSignal] = []
    seen_keys = set()  # dedup: a signal contributes its weight at most once
    for sig in SIGNALS:
        if sig.key in seen_keys:
            continue
        if not sig.applies(asset):
            continue
        if sig.pattern.search(blob):
            matched.append(MatchedSignal(sig.key, sig.label, sig.weight))
            seen_keys.add(sig.key)

    raw_score = sum(m.weight for m in matched)
    penalty, neg_notes = _negative_evidence_penalty(asset, blob)
    total = max(0, raw_score - penalty)
    return total, matched, neg_notes


# ─── Service: scan all controls for one asset ────────────────────────────────

@dataclass
class RecommendationResult:
    recommendations: List[RecommendationScore]
    total_controls_scanned: int
    total_already_linked: int
    asset_profile: dict  # what we used to drive the matcher


def recommend_for_asset(
    db: Session,
    asset: ITAsset,
    *,
    min_score: int = 1,
    limit: int = 100,
    framework_id: Optional[int] = None,
    include_linked: bool = False,
) -> RecommendationResult:
    """Score every framework control against the asset and return top matches."""

    linked_ids = {
        row.framework_control_id
        for row in db.query(AssetFrameworkControlLink.framework_control_id).filter(
            AssetFrameworkControlLink.asset_id == asset.id
        )
    }

    # Single eager-loaded scan: control -> objective -> domain -> framework.
    query = (
        db.query(FrameworkControl)
        .join(ControlObjective, FrameworkControl.objective_id == ControlObjective.id)
        .join(FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id)
        .join(Framework, FrameworkDomain.framework_id == Framework.id)
        .options(
            joinedload(FrameworkControl.objective)
            .joinedload(ControlObjective.domain)
            .joinedload(FrameworkDomain.framework)
        )
        .filter(Framework.is_active == True)  # noqa: E712 — SQLA boolean
    )
    if framework_id is not None:
        query = query.filter(Framework.id == framework_id)

    scored: List[RecommendationScore] = []
    scanned = 0
    for control in query.yield_per(500):
        scanned += 1
        if not include_linked and control.id in linked_ids:
            continue

        score, matched, neg = score_control_for_asset(asset, control)
        if score < min_score:
            continue

        framework: Optional[Framework] = None
        try:
            framework = control.objective.domain.framework
        except AttributeError:
            framework = None

        scored.append(
            RecommendationScore(
                framework_control_id=control.id,
                framework_id=framework.id if framework else None,
                framework_name=framework.name if framework else None,
                framework_short_code=framework.short_code if framework else None,
                code=control.code,
                name=control.name,
                statement=control.statement,
                score=score,
                confidence=_bucket(score),
                matched_signals=matched,
                negative_notes=neg,
            )
        )

    scored.sort(key=lambda r: (-r.score, r.framework_short_code or "", r.code))
    if limit:
        scored = scored[:limit]

    return RecommendationResult(
        recommendations=scored,
        total_controls_scanned=scanned,
        total_already_linked=len(linked_ids),
        asset_profile={
            "asset_type": asset.asset_type,
            "os_family": asset.os_family,
            "os_version": asset.os_version,
            "vendor": asset.vendor,
            "criticality": asset.criticality,
            "internet_facing": bool(getattr(asset, "internet_facing", False)),
            "network_segment": asset.network_segment,
            "data_classification": asset.data_classification,
            "business_function": asset.business_function,
            "compliance_scope": asset.compliance_scope or [],
        },
    )
