"""Review tool for the pre-generated artifact content (read-only).

Reads seed_data/artifact_content.json (the output of generate_artifact_content.py)
so you can inspect what has been generated and check quality — without squinting
at escaped JSON. Safe to run anytime, including WHILE generation is in progress
(it just reads whatever has been written so far).

Usage (from backend/):
    py -3 scripts/view_artifact_content.py                 # list everything generated
    py -3 scripts/view_artifact_content.py --framework dora # list one framework
    py -3 scripts/view_artifact_content.py DORA-001         # print ONE doc as markdown
    py -3 scripts/view_artifact_content.py --export         # write each doc to a .md file
                                                            #   -> backend/_artifact_preview/<fw>/<id>.md
                                                            #   open those in the IDE's markdown preview.
    py -3 scripts/view_artifact_content.py --export --framework dora
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
_CONTENT = _BACKEND / "grc" / "seed_data" / "artifact_content.json"
_PREVIEW = _BACKEND / "_artifact_preview"   # gitignore-able; safe to delete


def _load() -> dict:
    if not _CONTENT.exists():
        raise SystemExit(f"No content file yet at {_CONTENT} — nothing generated.")
    return json.loads(_CONTENT.read_text(encoding="utf-8"))


def _rows(data: dict, framework: str | None):
    for fw, arts in data.items():
        if framework and fw != framework:
            continue
        for aid, e in arts.items():
            d = e if isinstance(e, dict) else {}
            body = (d.get("content") or "") if d else str(e)
            yield (fw, aid, d.get("type", "?"), d.get("content_format", "?"),
                   d.get("model", "?"), d.get("title", aid), body)


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "").strip())[:80] or "untitled"


def main() -> None:
    ap = argparse.ArgumentParser(description="Inspect generated artifact content (read-only).")
    ap.add_argument("artifact_id", nargs="?", help="Print this one artifact's markdown")
    ap.add_argument("--framework", help="Filter to one framework_key")
    ap.add_argument("--export", action="store_true", help="Write each doc to a .md file for IDE preview")
    args = ap.parse_args()

    data = _load()
    rows = list(_rows(data, args.framework))

    # 1) print a single doc
    if args.artifact_id:
        hits = [r for r in rows if r[1].lower() == args.artifact_id.lower()]
        if not hits:
            raise SystemExit(f"{args.artifact_id} not found / not generated yet.")
        fw, aid, typ, cf, model, title, body = hits[0]
        print(f"# {title}\n<!-- {fw} / {aid} | type={typ} | mode={cf} | model={model} | {len(body)} chars -->\n")
        print(body)
        return

    # 2) export each doc as .md for IDE markdown preview
    if args.export:
        n = 0
        for fw, aid, typ, cf, model, title, body in rows:
            if not body.strip():
                continue
            out = _PREVIEW / fw / f"{aid}__{_safe(title)}.md"
            out.parent.mkdir(parents=True, exist_ok=True)
            header = f"<!-- {fw} / {aid} | type={typ} | mode={cf} | model={model} | {len(body)} chars -->\n\n"
            out.write_text(header + body, encoding="utf-8")
            n += 1
        print(f"Exported {n} document(s) to {_PREVIEW}")
        print("Open that folder in the IDE and use the markdown preview to review quality.")
        return

    # 3) default: list everything generated
    by_fw: dict = {}
    empty = 0
    for fw, aid, typ, cf, model, title, body in rows:
        by_fw.setdefault(fw, []).append((aid, typ, cf, model, len(body), title))
        if not body.strip():
            empty += 1
    total = sum(len(v) for v in by_fw.values())
    print(f"Generated entries: {total} of 922   (empty bodies: {empty})\n")
    for fw in sorted(by_fw):
        items = by_fw[fw]
        print(f"== {fw}  ({len(items)}) ==")
        for aid, typ, cf, model, chars, title in items:
            flag = "  <EMPTY!>" if chars == 0 else ""
            print(f"   {aid:<14} {str(typ):<12} {str(cf):<9} {chars:>6}c  {str(model):<9} {(title or '')[:44]}{flag}")
        print()


if __name__ == "__main__":
    main()
