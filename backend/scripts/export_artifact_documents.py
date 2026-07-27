"""Turn the generated artifact markdown into REAL typed documents — and keep
watching as the generator produces more.

Reads seed_data/artifact_content.json (the generator's output) and, for every
artifact, writes a native file in the type the artifact actually calls for:

    register / log / matrix (table)      → .xlsx
    artifact whose format is PDF         → .pdf
    artifact whose format is CSV         → .csv
    everything else (policy, procedure,
      charter, guide, form, letter …)    → .docx (Word)

It reuses the SAME markdown→file engine as the in-app download button
(grc/routers/_artifact_export.py), loaded directly so this stays a lightweight
script (no server / SESSION_SECRET needed).

Usage (from backend/):
    py -3 scripts/export_artifact_documents.py             # export all, then WATCH for new ones
    py -3 scripts/export_artifact_documents.py --once      # export current entries, then exit
    py -3 scripts/export_artifact_documents.py --framework iso_27001_2022
    py -3 scripts/export_artifact_documents.py --out D:\\artifacts --interval 5

Output: <out>/<framework_key>/<artifact_id>__<title>.<ext>   (default out = backend/_artifact_documents)
Safe to run WHILE the generator is running — it only (re)exports new or changed
entries (tracked by content hash in <out>/_manifest.json). Ctrl-C to stop watching.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import time
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
_CONTENT = _BACKEND / "grc" / "seed_data" / "artifact_content.json"
_OUT_DEFAULT = _BACKEND / "_artifact_documents"
_EXPORT_PATH = _BACKEND / "grc" / "routers" / "_artifact_export.py"

# Load the export engine directly by file path — avoids importing the grc.routers
# package (which would pull in auth and require SESSION_SECRET). The module is
# self-contained (stdlib + openpyxl/docx/reportlab imported lazily inside builders).
_spec = importlib.util.spec_from_file_location("_artifact_export", _EXPORT_PATH)
_export = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_export)
build_export = _export.build_export


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "").strip())[:80] or "untitled"


def _target_fmt(entry: dict) -> str:
    """The native file type this artifact should become."""
    cf = (entry.get("content_format") or "markdown").lower()
    fmt = (entry.get("format") or "").upper().split("/")[0].split("(")[0].strip()
    if cf == "table":
        return "xlsx"                     # registers / logs / matrices
    if fmt == "PDF":
        return "pdf"
    if fmt == "CSV":
        return "csv"
    if fmt == "XLSX":
        return "xlsx"
    return "docx"                          # documents + collection guides → Word


def _load(path: Path, retries: int = 6):
    """Read the JSON, tolerating a partial read while the generator is mid-write."""
    for _ in range(retries):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            time.sleep(0.3)
    return None


def export_all(out: Path, framework, manifest: dict) -> tuple:
    data = _load(_CONTENT)
    if data is None:
        return 0, 0
    made = failed = 0
    for fw, arts in data.items():
        if framework and fw != framework:
            continue
        if not isinstance(arts, dict):
            continue
        for aid, e in arts.items():
            if not isinstance(e, dict):
                continue
            content = e.get("content") or ""
            if not content.strip():
                continue
            fmt = _target_fmt(e)
            key = f"{fw}/{aid}"
            h = hashlib.sha1((fmt + "\n" + content).encode("utf-8")).hexdigest()
            if manifest.get(key, {}).get("hash") == h:
                continue                    # unchanged since last export
            title = e.get("title") or aid
            try:
                blob, _media, ext = build_export(
                    fmt, title=title, content=content,
                    content_format=e.get("content_format"), table=e.get("table"),
                )
            except Exception as exc:        # noqa: BLE001 — one bad doc must not stop the batch
                failed += 1
                print(f"[FAIL] {key}: {exc}", file=sys.stderr, flush=True)
                continue
            fw_dir = out / _safe(fw)
            fw_dir.mkdir(parents=True, exist_ok=True)
            fpath = fw_dir / f"{aid}__{_safe(title)}.{ext}"
            fpath.write_bytes(blob)
            manifest[key] = {"hash": h, "file": str(fpath)}
            made += 1
            print(f"[+] {key} -> {fpath.name} ({fmt})", flush=True)
    return made, failed


def main() -> None:
    ap = argparse.ArgumentParser(description="Export generated artifacts into real typed documents; optionally watch.")
    ap.add_argument("--out", default=str(_OUT_DEFAULT), help="Output directory (default: backend/_artifact_documents)")
    ap.add_argument("--framework", help="Only this framework_key")
    ap.add_argument("--once", action="store_true", help="Export current entries then exit (no watch)")
    ap.add_argument("--interval", type=float, default=5.0, help="Watch poll interval in seconds (default 5)")
    args = ap.parse_args()

    if not _CONTENT.exists():
        raise SystemExit(f"No content file at {_CONTENT} — run the generator first.")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "_manifest.json"
    manifest = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}

    print(f"[export] output -> {out}", flush=True)
    made, failed = export_all(out, args.framework, manifest)
    manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"[export] {made} written, {failed} failed. Total tracked: {len(manifest)}.", flush=True)

    if args.once:
        return

    print(f"[watch] watching {_CONTENT.name} every {args.interval:g}s for new artifacts — Ctrl-C to stop.", flush=True)
    try:
        last = _CONTENT.stat().st_mtime
    except OSError:
        last = 0
    try:
        while True:
            time.sleep(args.interval)
            try:
                m = _CONTENT.stat().st_mtime
            except OSError:
                continue
            if m == last:
                continue
            last = m
            made, failed = export_all(out, args.framework, manifest)
            if made or failed:
                manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
                print(f"[watch] +{made} new, {failed} failed (total {len(manifest)}).", flush=True)
    except KeyboardInterrupt:
        print("\n[watch] stopped.", flush=True)


if __name__ == "__main__":
    main()
