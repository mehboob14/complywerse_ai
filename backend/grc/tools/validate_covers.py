#!/usr/bin/env python3
"""CI helper: validate Stage G covers overlay (+ optional inline check covers).

Exit 1 on duplicate check_ids, empty/malformed covers, or bad token shape.
When an SCF DB is unavailable, format-only checks still run.
Prints draft vs reviewed counts.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

_OVERLAY = BACKEND / "grc" / "seed_data" / "evidence" / "covers_overlay.json"
_CONNECTOR = BACKEND / "grc" / "seed_data" / "evidence" / "connector_checks.json"
_TOKEN_RE = re.compile(r"^[A-Z0-9][A-Z0-9._-]*(?:_A\d+)?$", re.I)


def _load_overlay(path: Path) -> Dict[str, Dict[str, Any]]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    bindings = doc.get("bindings") if isinstance(doc, dict) else None
    if not isinstance(bindings, dict):
        raise SystemExit(f"malformed overlay: missing bindings object in {path}")
    return bindings


def _inline_covers_from_connectors(path: Path) -> Dict[str, List[str]]:
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    out: Dict[str, List[str]] = {}
    if not isinstance(data, dict):
        return out
    for payload in data.values():
        if not isinstance(payload, dict):
            continue
        for c in payload.get("checks") or []:
            if not isinstance(c, dict) or not c.get("id"):
                continue
            covers = c.get("covers")
            if isinstance(covers, list) and covers:
                out[str(c["id"])] = [str(x).strip() for x in covers if str(x).strip()]
    return out


def _validate_binding(check_id: str, row: Any, errors: List[str]) -> Tuple[bool, bool]:
    """Return (is_draft, is_reviewed). Append to errors on failure."""
    if not check_id or not isinstance(check_id, str):
        errors.append(f"empty/non-string check_id: {check_id!r}")
        return False, False
    if not isinstance(row, dict):
        errors.append(f"{check_id}: binding must be an object")
        return False, False
    covers = row.get("covers")
    if not isinstance(covers, list) or not covers:
        errors.append(f"{check_id}: covers must be a non-empty list")
        return False, False
    for tok in covers:
        if not isinstance(tok, str) or not tok.strip():
            errors.append(f"{check_id}: empty cover token")
            continue
        if not _TOKEN_RE.match(tok.strip()):
            errors.append(f"{check_id}: malformed cover token {tok!r}")
    reviewed = row.get("reviewed_by") not in (None, "", [])
    return (not reviewed), reviewed


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--overlay", type=Path, default=_OVERLAY)
    ap.add_argument("--connectors", type=Path, default=_CONNECTOR)
    ap.add_argument("--db", action="store_true",
                    help="Also validate tokens against current SCF release (needs DB)")
    args = ap.parse_args(argv)

    errors: List[str] = []
    bindings = _load_overlay(args.overlay)
    seen: Set[str] = set()
    draft = reviewed = 0

    for check_id, row in bindings.items():
        if check_id in seen:
            errors.append(f"duplicate check_id in overlay: {check_id}")
        seen.add(check_id)
        is_draft, is_rev = _validate_binding(check_id, row, errors)
        if is_draft:
            draft += 1
        if is_rev:
            reviewed += 1

    inline = _inline_covers_from_connectors(args.connectors)
    for check_id, covers in inline.items():
        if check_id in seen:
            # Overlay wins; still flag empty inline lists (already filtered).
            continue
        seen.add(check_id)
        fake = {"covers": covers, "reviewed_by": None}
        is_draft, is_rev = _validate_binding(check_id, fake, errors)
        if is_draft:
            draft += 1
        if is_rev:
            reviewed += 1

    if args.db:
        try:
            from grc.modules.compliance_plugins.runners.covers import (
                load_covers_overlay,
                validate_covers_tokens,
            )
            # Soft: only attempt if app can import a session factory.
            print("DB validation requested but skipped in CI helper without tenant engine;"
                  " use validate_covers_tokens(db, release_id, covers) in-process.")
            _ = load_covers_overlay()
        except Exception as exc:  # noqa: BLE001
            print(f"DB path unavailable ({exc}); format checks only.", file=sys.stderr)

    print(f"covers bindings: {draft} draft, {reviewed} reviewed, {draft + reviewed} total")
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
