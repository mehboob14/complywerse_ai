"""Parse an uploaded sheet, commit rows to ITAsset, and undo a batch.

Stateless: the client re-sends the file on /commit with the confirmed mapping,
so nothing is stored server-side between analyze and commit. Row -> asset upsert
mirrors the existing template importer (dedupe by name/host/ip, criticality
recompute, OS normalization) but lives here so the existing endpoint is untouched.
"""
from __future__ import annotations

import csv
import io
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from grc.models import ITAsset
from . import mapping as M

_VALID_TYPE = {"application", "infrastructure", "data", "cloud", "third_party"}
_MAX_ROWS = 5000  # ponytail: v1 cap; raise + stream when a client needs more

# Canonical field -> real ITAsset column when they differ. `owner` is a
# RELATIONSHIP, so it must NEVER be set directly (assigning a string to it throws
# "'str' object has no attribute '_sa_instance_state'") — route to owner_name, etc.
_COLUMN_ALIAS = {
    "owner": "owner_name",
    "mac_address": "primary_mac",
    "confidentiality": "confidentiality_rating",
    "integrity": "integrity_rating",
    "availability": "availability_rating",
}
_ASSET_COLUMNS = None


def _asset_columns():
    """Real mapped COLUMNS of ITAsset (never relationships), cached + lazy so the
    mapper is fully configured. We only ever setattr fields in this set."""
    global _ASSET_COLUMNS
    if _ASSET_COLUMNS is None:
        try:
            from sqlalchemy import inspect as _si
            _ASSET_COLUMNS = {c.key for c in _si(ITAsset).columns}
        except Exception:  # noqa: BLE001
            _ASSET_COLUMNS = set()
    return _ASSET_COLUMNS


# ── file parsing ─────────────────────────────────────────────────────────────
def _load_grid(content: bytes, filename: str) -> List[List[Any]]:
    """Raw grid (list of rows) of the file's active sheet. CSV + XLSX only."""
    name = (filename or "").lower()
    if name.endswith(".csv"):
        text = content.decode("utf-8-sig", errors="replace")
        return [list(r) for r in csv.reader(io.StringIO(text))]
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        try:
            ws = wb.active
            return [list(r) for r in ws.iter_rows(values_only=True)]
        finally:
            wb.close()
    raise ValueError("Unsupported file type — upload .csv or .xlsx (convert .xls to .xlsx first).")


def _clean(grid: List[List[Any]]) -> List[List[Any]]:
    return [r for r in grid if any(str(c if c is not None else "").strip() for c in r)]


# ── analyze (no writes) ──────────────────────────────────────────────────────
def analyze(content: bytes, filename: str, kind: str = "asset") -> Dict[str, Any]:
    fields = M.fields_for(kind)
    grid = _clean(_load_grid(content, filename))
    if not grid:
        raise ValueError("No data rows found in the file.")
    hidx = M.detect_header_row(grid, fields=fields)
    headers = [str(c if c is not None else "").strip() for c in grid[hidx]]
    data = grid[hidx + 1:]
    columns = [[row[i] for row in data[:25] if i < len(row)] for i in range(len(headers))]
    suggested = M.guess_mapping(headers, columns, fields=fields)
    samples = [
        {headers[i]: (row[i] if i < len(row) else None) for i in range(len(headers)) if headers[i]}
        for row in data[:8]
    ]
    try:
        from grc.services.openai_client import check_ai_available
        ai_ok = bool(check_ai_available())
    except Exception:  # noqa: BLE001
        ai_ok = False
    return {
        "filename": filename,
        "kind": kind,
        "header_row": hidx,
        "columns": [h for h in headers if h],
        "row_count": len(data),
        "sample_rows": samples,
        "suggested_mapping": {h: v for h, v in suggested.items() if h},
        "canonical_fields": [
            {"key": k, "label": v["label"], "required": bool(v.get("required"))}
            for k, v in fields.items()
        ],
        "ai_available": ai_ok,
    }


# ── commit ───────────────────────────────────────────────────────────────────
def _stash(asset: ITAsset, key: str, val: Any) -> None:
    """Extra (unmapped) fields go into platform_properties JSON — no schema change."""
    if not hasattr(asset, "platform_properties"):
        return
    props = dict(getattr(asset, "platform_properties", None) or {})
    props.setdefault("import_extra", {})[key] = val
    asset.platform_properties = props


def _apply(asset: ITAsset, rec: Dict[str, Any], normalize_os) -> None:
    cols = _asset_columns()
    for f, v in rec.items():
        if f == "asset_type":
            v = v if v in _VALID_TYPE else "infrastructure"
        elif f == "os_family" and normalize_os:
            try:
                v = normalize_os(str(v)) or v
            except Exception:  # noqa: BLE001
                pass
        col = _COLUMN_ALIAS.get(f, f)
        if col in cols:               # only ever set real columns, never relationships
            setattr(asset, col, v)
        else:
            _stash(asset, f, v)       # unknown/extra field -> platform_properties JSON
    if "asset_type" in cols and not getattr(asset, "asset_type", None):
        asset.asset_type = "infrastructure"


def _tag(asset: ITAsset, batch: str, filename: str, created: bool) -> None:
    """Batch id ONLY on created rows so undo can never delete a pre-existing
    asset that an import merely refreshed."""
    if not hasattr(asset, "platform_properties"):
        return
    props = dict(getattr(asset, "platform_properties", None) or {})
    if created:
        props["import_batch"] = batch
    props["import_source_file"] = filename
    asset.platform_properties = props


def commit(db: Session, tenant_id: int, content: bytes, filename: str,
           colmap: Dict[str, Optional[str]], dupe_strategy: str = "skip",
           header_row: Optional[int] = None) -> Dict[str, Any]:
    grid = _clean(_load_grid(content, filename))
    if not grid:
        raise ValueError("No data rows found in the file.")
    hidx = header_row if header_row is not None else M.detect_header_row(grid)
    headers = [str(c if c is not None else "").strip() for c in grid[hidx]]
    data = grid[hidx + 1:]
    if len(data) > _MAX_ROWS:
        raise ValueError(f"File has {len(data)} rows; the limit for one import is {_MAX_ROWS}.")

    field_by_col = {h: f for h, f in (colmap or {}).items() if f}
    if "name" not in field_by_col.values() and not any(
        f in field_by_col.values() for f in ("host_name", "ip_address")
    ):
        raise ValueError("Map at least one column to Asset name (or hostname / IP).")

    try:
        from grc.services.asset_criticality import recompute_for_asset
    except Exception:  # noqa: BLE001
        recompute_for_asset = None
    try:
        from grc.modules.compliance_plugins.services.os_detector import normalize_os_string
    except Exception:  # noqa: BLE001
        normalize_os_string = None

    batch = uuid.uuid4().hex[:12]
    created = updated = skipped = 0
    errors: List[str] = []

    for rn, row in enumerate(data, start=1):
        try:
            rec = M.apply_mapping(headers, row, field_by_col)
            ident = rec.get("name") or rec.get("host_name") or rec.get("ip_address")
            if not ident:
                errors.append(f"Row {rn}: no name / hostname / IP — skipped")
                continue
            rec.setdefault("name", str(ident))
            # per-row savepoint: a bad row rolls back alone, the batch survives
            with db.begin_nested():
                q = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id)
                existing = q.filter(func.lower(ITAsset.name) == str(rec["name"]).lower()).first()
                if not existing and rec.get("host_name"):
                    existing = q.filter(ITAsset.host_name == rec["host_name"]).first()
                if not existing and rec.get("ip_address"):
                    existing = q.filter(ITAsset.ip_address == rec["ip_address"]).first()

                if existing:
                    if dupe_strategy != "update":
                        skipped += 1
                    else:
                        _apply(existing, rec, normalize_os_string)
                        _tag(existing, batch, filename, created=False)
                        db.flush()
                        if recompute_for_asset:
                            try:
                                recompute_for_asset(db, existing)
                            except Exception:  # noqa: BLE001
                                pass
                        updated += 1
                else:
                    asset = ITAsset(tenant_id=tenant_id)
                    _apply(asset, rec, normalize_os_string)
                    if hasattr(asset, "origin_source"):
                        asset.origin_source = "import"
                    _tag(asset, batch, filename, created=True)
                    db.add(asset)
                    db.flush()
                    if recompute_for_asset:
                        try:
                            recompute_for_asset(db, asset)
                        except Exception:  # noqa: BLE001
                            pass
                    created += 1
        except Exception as e:  # noqa: BLE001 — one bad row must not kill the batch
            errors.append(f"Row {rn}: {e}")

    db.commit()
    changed = created + updated
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors[:50],
        "total_errors": len(errors),
        "row_count": len(data),
        "batch_id": batch,
        "message": (f"Imported {created} new, updated {updated}, skipped {skipped}."
                    if changed or skipped else "Nothing imported."),
    }


# ── undo ─────────────────────────────────────────────────────────────────────
def undo(db: Session, tenant_id: int, batch_id: str) -> Dict[str, Any]:
    """Delete only the assets CREATED by this batch (batch id lives on created
    rows only). Guarded per-asset so a row that has since gained children (FK)
    is reported rather than aborting the whole undo."""
    rows = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
    victims = [
        a for a in rows
        if (getattr(a, "platform_properties", None) or {}).get("import_batch") == batch_id
    ]
    deleted = failed = 0
    for a in victims:
        try:
            db.delete(a)
            db.flush()
            deleted += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            failed += 1
    db.commit()
    return {
        "deleted": deleted,
        "failed": failed,
        "batch_id": batch_id,
        "message": f"Removed {deleted} imported asset(s)." + (f" {failed} could not be removed (in use)." if failed else ""),
    }


# ── validate: dry-run the mapping (no writes) ─────────────────────────────────
# Fields whose normalize_value returns None for a NON-empty cell means the value
# was unrecognized (bad enum / unparseable number or date) — worth flagging.
_ENUMISH_ASSET = {"criticality", "confidentiality", "integrity", "availability",
                  "data_classification", "status", "lifecycle_state", "purchase_cost",
                  "valuation", "cpu_cores", "memory_gb", "storage_gb",
                  "purchase_date", "warranty_expiry", "eol_date"}
_ENUMISH_VULN = {"severity", "cvss_score"}
_PREVIEW_ROWS = 200  # per-row issue detail is capped; counts still cover every row


def _looks_ipv4(s: str) -> bool:
    parts = s.strip().split(".")
    return len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def _row_issues(rec_pairs, enumish) -> List[Dict[str, str]]:
    """rec_pairs = list of (field, raw, normalized). Flag unrecognized enums/numbers,
    bad IPs. Free-text fields never fail so they're never flagged."""
    issues: List[Dict[str, str]] = []
    for f, raw, val in rec_pairs:
        raws = str(raw).strip() if raw is not None else ""
        if not raws:
            continue
        if val is None and f in enumish:
            issues.append({"level": "warn", "field": f, "message": f"unrecognized value '{raws[:40]}' — will be left blank"})
        if f == "ip_address" and not _looks_ipv4(raws):
            issues.append({"level": "warn", "field": f, "message": f"'{raws[:40]}' is not a valid IPv4 address"})
    return issues


def validate(db: Session, tenant_id: int, content: bytes, filename: str,
             colmap: Dict[str, Optional[str]], dupe_strategy: str = "skip",
             header_row: Optional[int] = None) -> Dict[str, Any]:
    """Dry-run: what WOULD happen on commit — per-row create/update/skip/error +
    data-quality issues. Writes nothing."""
    grid = _clean(_load_grid(content, filename))
    if not grid:
        raise ValueError("No data rows found in the file.")
    hidx = header_row if header_row is not None else M.detect_header_row(grid)
    headers = [str(c if c is not None else "").strip() for c in grid[hidx]]
    data = grid[hidx + 1:]
    field_by_col = {h: f for h, f in (colmap or {}).items() if f}

    ex = db.query(ITAsset.name, ITAsset.host_name, ITAsset.ip_address).filter(
        ITAsset.tenant_id == tenant_id).all()
    names = {str(n).lower() for n, _, _ in ex if n}
    hosts = {str(h).lower() for _, h, _ in ex if h}
    ips = {str(ip).lower() for _, _, ip in ex if ip}

    counts = {"create": 0, "update": 0, "skip": 0, "error": 0}
    rows_out: List[Dict[str, Any]] = []
    for rn, row in enumerate(data, start=1):
        pairs, rec = [], {}
        for i, h in enumerate(headers):
            f = field_by_col.get(h)
            if not f:
                continue
            raw = row[i] if i < len(row) else None
            val = M.normalize_value(f, raw)
            pairs.append((f, raw, val))
            if val is not None:
                rec[f] = val
        issues = _row_issues(pairs, _ENUMISH_ASSET)
        ident = rec.get("name") or rec.get("host_name") or rec.get("ip_address")
        if not ident:
            issues.append({"level": "error", "field": "name", "message": "no name / hostname / IP — row will be skipped"})
            action = "error"
        else:
            nm = str(rec.get("name") or ident).lower()
            dup = nm in names or (rec.get("host_name") and str(rec["host_name"]).lower() in hosts) \
                or (rec.get("ip_address") and str(rec["ip_address"]).lower() in ips)
            action = ("update" if dupe_strategy == "update" else "skip") if dup else "create"
        counts[action] += 1
        if len(rows_out) < _PREVIEW_ROWS:
            rows_out.append({"row": rn, "identity": str(ident) if ident else None,
                             "action": action, "issues": issues})
    counts["total"] = len(data)
    return {"kind": "asset", "summary": counts, "rows": rows_out,
            "row_count": len(data), "shown": len(rows_out)}


def validate_vulns(db: Session, tenant_id: int, content: bytes, filename: str,
                   colmap: Dict[str, Optional[str]], dupe_strategy: str = "skip",
                   header_row: Optional[int] = None) -> Dict[str, Any]:
    """Dry-run for the vuln register: create/skip + which rows auto-link to an asset."""
    from grc.models import Vulnerability, ITAsset
    grid = _clean(_load_grid(content, filename))
    if not grid:
        raise ValueError("No data rows found in the file.")
    hidx = header_row if header_row is not None else M.detect_header_row(grid, fields=M.VULN_FIELDS)
    headers = [str(c if c is not None else "").strip() for c in grid[hidx]]
    data = grid[hidx + 1:]
    field_by_col = {h: f for h, f in (colmap or {}).items() if f}

    assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
    existing = {(str(t).lower(), (str(h).lower() if h else "")) for t, h in
                db.query(Vulnerability.title, Vulnerability.affected_host).filter(
                    Vulnerability.tenant_id == tenant_id).all()}

    counts = {"create": 0, "update": 0, "skip": 0, "error": 0, "linked": 0}
    rows_out: List[Dict[str, Any]] = []
    for rn, row in enumerate(data, start=1):
        pairs, rec = [], {}
        for i, h in enumerate(headers):
            f = field_by_col.get(h)
            if not f:
                continue
            raw = row[i] if i < len(row) else None
            val = M.normalize_value(f, raw)
            pairs.append((f, raw, val))
            if val is not None:
                rec[f] = val
        issues = _row_issues(pairs, _ENUMISH_VULN)
        title = rec.get("title")
        host = rec.get("affected_host")
        will_link = False
        if not title:
            issues.append({"level": "error", "field": "title", "message": "no title — row will be skipped"})
            action = "error"
        elif (str(title).lower(), (str(host).lower() if host else "")) in existing:
            action = "skip"
        else:
            action = "create"
            if _find_asset(assets, host) is not None:
                will_link = True
                counts["linked"] += 1
        counts[action] += 1
        if len(rows_out) < _PREVIEW_ROWS:
            rows_out.append({"row": rn, "identity": str(title) if title else None,
                             "action": action, "linked": will_link, "issues": issues})
    counts["total"] = len(data)
    return {"kind": "vuln", "summary": counts, "rows": rows_out,
            "row_count": len(data), "shown": len(rows_out)}


# ── import history (past batches, for the history + undo UI) ───────────────────
def history(db: Session, tenant_id: int, kind: str = "asset", limit: int = 25) -> Dict[str, Any]:
    """List past import batches so the UI can show them + offer undo.
    Assets: batches live in platform_properties JSON. Vulns: VulnerabilityReport rows."""
    if kind == "vuln":
        from grc.models import VulnerabilityReport
        q = db.query(VulnerabilityReport).filter(
            VulnerabilityReport.tenant_id == tenant_id,
            VulnerabilityReport.scan_tool == "excel_import",
        ).order_by(VulnerabilityReport.id.desc()).limit(limit).all()
        items = [{
            "batch_id": str(r.id),
            "filename": getattr(r, "file_name", None) or getattr(r, "name", None) or "import",
            "count": int(getattr(r, "total_vulnerabilities", 0) or 0),
            "created_at": (getattr(r, "created_at", None).isoformat()
                           if getattr(r, "created_at", None) else None),
        } for r in q]
        return {"kind": "vuln", "items": items}

    # assets — aggregate created rows by their import_batch tag
    from sqlalchemy import cast, String
    pp = ITAsset.platform_properties
    batch_key = pp.op("->>")("import_batch")
    file_key = pp.op("->>")("import_source_file")
    rows = db.query(
        batch_key.label("batch"),
        func.max(file_key).label("filename"),
        func.count(ITAsset.id).label("count"),
        func.min(ITAsset.created_at).label("created_at") if hasattr(ITAsset, "created_at") else func.min(ITAsset.id),
    ).filter(
        ITAsset.tenant_id == tenant_id, batch_key.isnot(None),
    ).group_by(batch_key).all()
    items = [{
        "batch_id": r.batch,
        "filename": r.filename or "import",
        "count": int(r.count or 0),
        "created_at": (r.created_at.isoformat() if hasattr(r, "created_at") and getattr(r, "created_at", None)
                       and hasattr(r.created_at, "isoformat") else None),
    } for r in rows if r.batch]
    items.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return {"kind": "asset", "items": items[:limit]}


# ── vulnerabilities (Phase 2) ────────────────────────────────────────────────
def _find_asset(assets, host):
    """Match a finding's affected host/IP to an asset by name/host/ip/fqdn/known_ips."""
    if not host:
        return None
    h = str(host).strip().lower()
    if not h:
        return None
    for a in assets:
        for cand in (getattr(a, "name", None), getattr(a, "host_name", None),
                     getattr(a, "ip_address", None), getattr(a, "fqdn", None)):
            if cand and str(cand).strip().lower() == h:
                return a
        ki = getattr(a, "known_ips", None)
        if isinstance(ki, list) and any(str(x).strip().lower() == h for x in ki):
            return a
    return None


def commit_vulns(db: Session, tenant_id: int, content: bytes, filename: str,
                 colmap: Dict[str, Optional[str]], dupe_strategy: str = "skip",
                 header_row: Optional[int] = None) -> Dict[str, Any]:
    """Create findings from an uploaded sheet, batched under a VulnerabilityReport
    (the provenance/undo unit), auto-linked to assets by affected host/IP."""
    from grc.models import Vulnerability, VulnerabilityAssetLink, VulnerabilityReport, ITAsset

    grid = _clean(_load_grid(content, filename))
    if not grid:
        raise ValueError("No data rows found in the file.")
    hidx = header_row if header_row is not None else M.detect_header_row(grid, fields=M.VULN_FIELDS)
    headers = [str(c if c is not None else "").strip() for c in grid[hidx]]
    data = grid[hidx + 1:]
    if len(data) > _MAX_ROWS:
        raise ValueError(f"File has {len(data)} rows; the limit for one import is {_MAX_ROWS}.")
    field_by_col = {h: f for h, f in (colmap or {}).items() if f}
    if "title" not in field_by_col.values():
        raise ValueError("Map at least one column to Title.")

    report = VulnerabilityReport(
        tenant_id=tenant_id, name=f"Excel import — {filename}", report_type="import",
        scan_tool="excel_import", status="parsed", file_name=filename, file_type="excel",
    )
    db.add(report)
    db.flush()  # get report.id (the batch id)

    assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
    base = db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id).count()
    created = linked = skipped = 0
    errors: List[str] = []

    for rn, row in enumerate(data, start=1):
        try:
            rec = M.apply_mapping(headers, row, field_by_col)
            title = rec.get("title")
            if not title:
                errors.append(f"Row {rn}: no title — skipped")
                continue
            host = rec.get("affected_host")
            with db.begin_nested():
                dup = db.query(Vulnerability).filter(
                    Vulnerability.tenant_id == tenant_id,
                    func.lower(Vulnerability.title) == str(title).lower(),
                    func.coalesce(Vulnerability.affected_host, "") == (host or ""),
                ).first()
                if dup:
                    skipped += 1
                else:
                    v = Vulnerability(
                        tenant_id=tenant_id, report_id=report.id,
                        vuln_id=f"IMP-{report.id}-{base + created + 1}",
                        title=str(title)[:500],
                        severity=(rec.get("severity") or "info"),
                        cvss_score=rec.get("cvss_score"),
                        cve_id=rec.get("cve_id"),
                        cwe_id=rec.get("cwe_id"),
                        description=rec.get("description"),
                        recommendation=rec.get("recommendation"),
                        affected_host=host,
                        affected_component=rec.get("affected_component"),
                        status="open",
                    )
                    db.add(v)
                    db.flush()
                    created += 1
                    a = _find_asset(assets, host)
                    if a is not None:
                        db.add(VulnerabilityAssetLink(
                            vulnerability_id=v.id, asset_id=a.id,
                            link_source="import", auto_linked=True,
                        ))
                        db.flush()
                        linked += 1
        except Exception as e:  # noqa: BLE001
            errors.append(f"Row {rn}: {e}")

    try:
        report.total_vulnerabilities = created
    except Exception:  # noqa: BLE001
        pass
    db.commit()
    return {
        "created": created, "updated": 0, "skipped": skipped,
        "errors": errors[:50], "total_errors": len(errors),
        "row_count": len(data), "batch_id": str(report.id),
        "message": f"Imported {created} finding(s) — {linked} auto-linked to assets, {skipped} skipped.",
    }


def undo_vulns(db: Session, tenant_id: int, batch_id: str) -> Dict[str, Any]:
    """Delete the findings created by an import batch (VulnerabilityReport id),
    their asset links, and the report row."""
    from grc.models import Vulnerability, VulnerabilityAssetLink, VulnerabilityReport
    try:
        rid = int(batch_id)
    except (TypeError, ValueError):
        return {"deleted": 0, "failed": 0, "batch_id": batch_id, "message": "Invalid batch id."}
    vulns = db.query(Vulnerability).filter(
        Vulnerability.tenant_id == tenant_id, Vulnerability.report_id == rid,
    ).all()
    deleted = failed = 0
    for v in vulns:
        try:
            db.query(VulnerabilityAssetLink).filter(
                VulnerabilityAssetLink.vulnerability_id == v.id
            ).delete(synchronize_session=False)
            db.delete(v)
            db.flush()
            deleted += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            failed += 1
    try:
        rep = db.query(VulnerabilityReport).filter(
            VulnerabilityReport.id == rid, VulnerabilityReport.tenant_id == tenant_id
        ).first()
        if rep is not None:
            db.delete(rep)
    except Exception:  # noqa: BLE001
        pass
    db.commit()
    return {
        "deleted": deleted, "failed": failed, "batch_id": batch_id,
        "message": f"Removed {deleted} imported finding(s)." + (f" {failed} could not be removed (in use)." if failed else ""),
    }
