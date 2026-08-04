"""One-time, FORMAT-AWARE generator for type- and control-specific artifact content.

The governance "Artifact Templates" library (seed_data/artifact_catalog.json) lists
922 artifacts across 32 frameworks, each with an intended `format` (DOCX/XLSX/PDF/…).
This script generates the RIGHT kind of output per artifact and stores it in
seed_data/artifact_content.json, keyed `{framework_key: {artifact_id: {...}}}`:

  • markdown (DOCX/PDF/Form/Letter docs) — a complete, best-practice DOCUMENT body
    (rich markdown source; export to Word/PDF at download time).
  • table (XLSX/CSV register/log/matrix) — an EDITABLE COLUMN TEMPLATE: the exact
    columns the control requires + per-column guidance + 1-2 [EXAMPLE] rows the user
    replaces. Stored structured (`table`: columns/field_guidance/example_rows) so a
    real .csv/.xlsx can be produced, plus a rendered markdown table in `content`.
  • guide (ZIP/Drive/Dashboard/Portal/ITSM/Logs/Tool/DB) — these CANNOT be authored
    (they are collected from the org's systems), so instead of faking them we emit a
    short GUIDE on HOW and WHERE to collect the evidence from the user's setup.

Each entry stores: title, type, format, content, content_format (markdown|table|guide),
table (tabular only), model, generated_at.

Run (resumable — writes after every artifact; smart-resume regenerates entries whose
mode is out of date). From scratch, regenerate everything with --force:

    cd backend
    $env:PYTHONPATH="."; py -3 -u scripts/generate_artifact_content.py --force
    # options:
    #   --framework iso_27001_2022   only one framework
    #   --type Charter               only one artifact type
    #   --limit 5                    cap how many are generated this run (smoke test)
    #   --force                      regenerate everything (use for a from-scratch run)
    #   --model gpt-4o               override the model (default = latest, gpt-5.5)

Requires a real OpenAI key (AI_INTEGRATIONS_OPENAI_* / OPENAI_API_KEY in .env).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# Make `grc` importable + load .env when run as a plain script from backend/.
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
try:
    from dotenv import load_dotenv
    load_dotenv(_BACKEND / ".env")
except Exception:
    pass

from grc.config import get_openai_api_key, get_openai_model  # noqa: E402
# Importing grc.config also installs the gpt-5.x/o-series param-compat shim,
# so this script's chat-completion calls work with the latest models too.

_CATALOG = _BACKEND / "grc" / "seed_data" / "artifact_catalog.json"
_CONTENT = _BACKEND / "grc" / "seed_data" / "artifact_content.json"

# ── Type-aware structure guidance. Each artifact TYPE gets the section skeleton a
# competent GRC author would use, so a Charter never reads like a Procedure. The
# LLM fills these with framework- and control-specific substance. ──────────────
_TYPE_SECTIONS = {
    "policy": ["Purpose", "Scope", "Policy Statements (numbered, mandatory 'shall' requirements)",
               "Roles & Responsibilities", "Compliance, Monitoring & Enforcement", "Exceptions", "Review & Maintenance"],
    "standard": ["Purpose", "Scope", "Normative Requirements (specific, measurable, testable)",
                 "Baseline Configurations / Parameters", "Verification & Compliance", "Review & Maintenance"],
    "procedure": ["Purpose", "Scope", "Prerequisites & Inputs", "Step-by-Step Procedure (numbered)",
                  "Roles & RACI", "Records & Outputs", "Exceptions & Escalation", "Review"],
    "charter": ["Purpose & Mandate", "Sponsor & Authority", "Objectives", "Scope & Boundaries",
                "Governance Structure", "Roles & Responsibilities", "Resources & Budget",
                "Timeline & Milestones", "Success Criteria", "Approval"],
    "register": ["Purpose", "Scope", "Register Fields (markdown table: Field | Description | Example)",
                 "Sample Entries (markdown table with 2-3 realistic rows)", "Maintenance Process & Cadence",
                 "Roles & Responsibilities", "Review"],
    "plan": ["Purpose & Objectives", "Scope", "Assumptions & Dependencies", "Approach / Phases",
             "Milestones & Timeline (markdown table)", "Roles & Responsibilities", "Resources",
             "Success Metrics", "Review & Update Triggers"],
    "report": ["Purpose", "Reporting Period & Scope", "Executive Summary", "Methodology",
               "Detailed Findings / Results (with structure)", "Analysis", "Recommendations & Actions",
               "Distribution & Confidentiality"],
    "log": ["Purpose", "Scope", "Captured Fields (markdown table: Field | Description)",
            "Sample Entries (markdown table)", "Retention & Access", "Review"],
    "assessment": ["Purpose", "Scope", "Methodology", "Assessment Criteria & Scoring",
                   "Assessment Process", "Findings Structure", "Reporting & Remediation", "Review"],
    "form": ["Purpose", "Instructions", "Form Fields (markdown table: Field | Type | Required | Guidance)",
             "Approval / Routing", "Records & Retention"],
    "matrix": ["Purpose", "Scope", "The Matrix (markdown table with clearly-labelled axes)",
               "How to Interpret & Use", "Maintenance", "Review"],
    "attestation": ["Purpose", "Scope", "Attestation Statement", "Signatory & Authority",
                    "Evidence Referenced", "Frequency", "Records & Retention"],
    "strategy": ["Purpose & Vision", "Strategic Objectives", "Current State", "Target State",
                 "Initiatives & Roadmap (markdown table)", "Governance", "Metrics & KPIs", "Review"],
    "agreement": ["Purpose", "Parties", "Scope of Services / Obligations", "Terms & Conditions",
                  "Security & Compliance Obligations", "SLAs / Metrics", "Term, Renewal & Termination", "Signatures"],
    "training": ["Purpose & Learning Objectives", "Target Audience", "Scope", "Content Outline / Modules",
                 "Delivery & Frequency", "Assessment & Records", "Review"],
    "evidence": ["Purpose", "What This Evidence Demonstrates", "Scope", "Required Contents",
                 "Collection & Validation", "Retention & Access"],
}
# Coarse-type → skeleton key.
_TYPE_ALIASES = {
    "policy": "policy", "standard": "standard", "guideline": "policy", "procedure": "procedure",
    "process": "procedure", "charter": "charter", "register": "register", "plan": "plan",
    "report": "report", "record/log": "log", "record": "log", "log": "log",
    "assessment": "assessment", "form/template": "form", "form": "form", "template": "form",
    "matrix": "matrix", "attestation": "attestation", "strategy": "strategy",
    "agreement": "agreement", "training": "training", "evidence": "evidence",
}


def _skeleton(artifact_type: str) -> tuple:
    t = (artifact_type or "").strip().lower()
    key = _TYPE_ALIASES.get(t)
    if not key:
        for alias, k in _TYPE_ALIASES.items():
            if alias in t:
                key = k
                break
    key = key or "policy"
    return key, _TYPE_SECTIONS[key]


def _client():
    from openai import OpenAI
    return OpenAI(api_key=get_openai_api_key(), base_url=os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL"))


def _ai_available() -> bool:
    base = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL", "")
    if "modelfarm" in base:
        return True
    key = get_openai_api_key()
    return bool(key) and not key.startswith("_DUMMY") and key != "your-api-key-here" and len(key) >= 20


_SYS = ("You are a senior GRC documentation specialist (CISA, CISSP, ISO 27001 Lead Implementer). "
        "You write precise, audit-ready governance documents that follow recognised best practice for each "
        "document type. Output GitHub-flavoured Markdown only — no preamble, no code fences. "
        "CRITICAL: never cite framework clause numbers, control-reference codes, annex numbers or standard "
        "section numbers anywhere — no 'Clause 5.1', no 'A.5.9', no 'Control Reference' row, no 'per ISO/IEC "
        "27001:2022 §...'. Write each document on its own merits in plain business language; the reader does "
        "not want regulatory citations or clause tags cluttering the text. Use a normal en-dash '-' character.")
_SYS_TABLE = ("You are a senior GRC analyst designing the register/log/matrix an auditor expects. "
              "Return STRICT JSON only — no prose, no markdown, no code fences.")

# ── Format-aware generation. The catalog gives each artifact a `format` (DOCX,
# XLSX, PDF, ZIP/Drive, ITSM, …). We map it (+ the artifact type) to one of three
# generation MODES so the output suits the artifact:
#   markdown → an authored document (DOCX/PDF/Form/Letter/Web → rich markdown source)
#   table    → a tabular artifact (XLSX/CSV register/log/matrix → columns + sample rows;
#              stored as structured data AND a markdown table, so a real .xlsx can be
#              built later via openpyxl while the existing create flow still works)
#   guide    → evidence COLLECTED FROM a system (Dashboard/Portal/ITSM/ZIP/Logs/Tool/DB)
#              — not a document to author, so we produce a short collection guide.
_FMT_TABLE = {"XLSX", "CSV"}
_FMT_DOC = {"DOCX", "PDF", "DOC", "PPTX", "WEB", "FORM", "LETTER", "LETTERS", "VISIO", "DIAGRAMS"}
_FMT_SYS = {"ZIP", "DRIVE", "DASHBOARD", "PORTAL", "ITSM", "TOOL", "DB", "LOGS", "LOG", "CONSOLE",
            "CMDB", "CMMS", "CONFIGS", "VARIOUS", "ARCHITECTURE", "DMS", "PHOTOS", "REPORTS"}
_TABULAR_TYPES = {"register", "log", "record/log", "record", "matrix"}


def _content_mode(fmt: str, artifact_type: str) -> str:
    primary = (fmt or "").upper().split("/")[0].split("(")[0].strip()
    atype = (artifact_type or "").strip().lower()
    if atype in _TABULAR_TYPES:
        if primary in _FMT_SYS and primary not in _FMT_TABLE:
            return "guide"      # a Record/Log that's really pulled from ITSM/Logs/a tool
        return "table"          # registers/logs/matrices are tabular by nature
    if primary in _FMT_TABLE:
        return "table"
    if primary in _FMT_DOC:
        return "markdown"
    if primary in _FMT_SYS:
        return "guide"
    return "markdown"           # safe default


def _prompt(framework_name: str, name: str, artifact_type: str, control_ref: str,
            description: str, sections: list) -> str:
    return (
        f"Write a complete, professional **{artifact_type}** document for an organisation implementing "
        f"**{framework_name}**.\n\n"
        f"Document title: {name}\n"
        f"Artifact type: {artifact_type}\n"
        f"(Internal scope hint — do NOT print this or any clause number: {control_ref or 'general obligation'})\n"
        f"Intent / description: {description or 'Not provided.'}\n\n"
        "Requirements:\n"
        f"1. Follow best practice for a **{artifact_type}** specifically — its structure, tone and level of "
        "detail must match this document type (a Charter is not a Procedure; a Report has findings; a Policy "
        "states mandatory requirements).\n"
        "2. Make the substance SPECIFIC and practical — cover what this document type genuinely needs for this "
        "framework, in plain language — not generic filler. Do NOT cite clause numbers or the control reference; "
        "express the requirements in your own words.\n"
        "3. Use exactly these top-level sections (## headings), in order:\n"
        + "\n".join(f"   - {s}" for s in sections) + "\n"
        "4. Start with a short metadata block (Document ID, Version, Owner, Effective Date, Framework, "
        "Classification) as a markdown table. Do NOT include a 'Control Reference' row.\n"
        "5. Where the type calls for inline tables (forms, timelines), include realistic markdown tables.\n"
        "6. Use [bracketed placeholders] only for genuinely org-specific values (names, dates, systems).\n"
        "7. Do NOT include any framework clause numbers, control-reference codes, annex numbers, or citations "
        "anywhere (no 'Clause X', no '(A.5.9)', no 'Control Reference' row).\n"
        "8. Be thorough and ready-to-use; aim for a document an auditor would accept as a strong first draft."
    )


def _prompt_table(framework_name: str, name: str, artifact_type: str, control_ref: str,
                  description: str, fmt: str) -> str:
    return (
        f"Design a blank, EDITABLE {fmt} TEMPLATE for **{name}** — a {artifact_type} — for an organisation "
        f"implementing **{framework_name}** (control {control_ref or 'general obligation'}).\n"
        f"Intent: {description or 'Not provided.'}\n\n"
        "This is a TEMPLATE the organisation will fill in themselves — NOT a populated record. Your job is to "
        "define the right COLUMNS and explain exactly what goes in each, based on what this control/artifact "
        "actually requires.\n\n"
        "Return STRICT JSON ONLY with this exact shape (no code fences, no commentary):\n"
        '{ "columns": ["..."], "field_guidance": {"Column": "precise instruction for what the user enters here, '
        'incl. format/allowed values where relevant"}, "example_rows": [["..."]], '
        '"maintenance": "who owns this template, how often it is updated, and the source system it draws from" }\n\n'
        "Rules:\n"
        f"- columns: the COMPLETE, specific column set this {artifact_type} needs to satisfy "
        f"{framework_name} {control_ref or ''} — derived from what that control actually requires. "
        "Concrete and audit-grade, never generic filler.\n"
        "- field_guidance: ONE clear instruction per column (every column must have an entry) so a user knows "
        "exactly what to record, including expected format, units, or allowed values (e.g. dates as YYYY-MM-DD, "
        "a RAG status, a control ref).\n"
        "- example_rows: ONE or TWO illustrative rows ONLY, and wrap EVERY cell value like `[EXAMPLE: ...]` so it "
        "is obviously placeholder text the user must replace.\n"
        "- maintenance: 1-2 sentences (owner role, update cadence, source system)."
    )


def _prompt_guide(framework_name: str, name: str, artifact_type: str, control_ref: str,
                  description: str, fmt: str) -> str:
    return (
        f"**{name}** is a {artifact_type} whose format is '{fmt}'. This artifact CANNOT be authored as a "
        f"document — it is operational evidence that must be COLLECTED FROM the organisation's own systems "
        f"(e.g. SIEM/log store, ITSM/ticketing, a portal, a tool, or a dashboard). Do NOT fabricate the "
        f"evidence itself. Instead, write a concise, practical GUIDE telling the user HOW and WHERE to "
        f"collect it from THEIR setup, for an organisation implementing **{framework_name}** "
        f"(control {control_ref or 'general obligation'}).\n"
        f"Intent: {description or 'Not provided.'}\n\n"
        "Output GitHub-flavoured Markdown (no code fences) with these ## sections:\n"
        "- What This Evidences (tie explicitly to the control, and state plainly that it is collected, not authored)\n"
        "- Where To Collect It From (the source system/tool in a typical setup; name the kind of system)\n"
        "- How To Collect (concrete, ordered steps an operator can follow)\n"
        "- What To Capture (the exact fields/records/screens that make it sufficient)\n"
        "- Frequency & Owner\n"
        "- Retention & Storage\n"
        "- Acceptance Criteria (what an auditor accepts as sufficient)\n\n"
        "Keep it tight (~350-550 words). Use [bracketed placeholders] for org-specific tool/system names."
    )


def _strip_fences(t: str) -> str:
    t = (t or "").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        if t.endswith("```"):
            t = t[:-3]
    return t.strip()


def _call_md(client, model: str, system: str, prompt: str, max_toks: int) -> str:
    resp = client.chat.completions.create(
        model=model, temperature=0.4, max_tokens=max_toks,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
    )
    text = _strip_fences(resp.choices[0].message.content)
    if not text:
        fr = getattr(resp.choices[0], "finish_reason", "?")
        raise RuntimeError(f"empty content (finish_reason={fr}; try a larger budget or --model gpt-4o)")
    return text


def _render_table_md(title: str, columns: list, example_rows: list, field_guidance: dict,
                     maintenance: str, fmt: str = "") -> str:
    label = f" ({fmt} template)" if fmt else " (template)"
    out = [
        f"## {title or 'Template'}{label}",
        "",
        "_Editable template — add your own rows. The example row(s) below are placeholders to replace._",
        "",
    ]
    if columns:
        out.append("| " + " | ".join(str(c) for c in columns) + " |")
        out.append("| " + " | ".join("---" for _ in columns) + " |")
        for r in (example_rows or [["" for _ in columns]]):
            cells = [str(x) for x in (r or [])][:len(columns)]
            cells += [""] * (len(columns) - len(cells))
            out.append("| " + " | ".join(cells) + " |")
    if field_guidance:
        out += ["", "### Column Guidance", "", "| Column | What to enter |", "|---|---|"]
        out += [f"| {k} | {v} |" for k, v in field_guidance.items()]
    if maintenance:
        out += ["", "### Maintenance", "", str(maintenance)]
    return "\n".join(out).strip()


# ── Sanitizer — strip clause/control-reference citations the model sometimes adds
# despite the prompt, and repair mangled dashes. Conservative + best-effort so it
# never mangles real prose. Applied to every generated body, and available as a
# one-time `--sanitize` cleanup for already-generated content.
_CLAUSE_RE = re.compile(r"\s*\bClauses?\s+\d+(?:\.\d+)*(?:\s*(?:,|and|&|to|-)\s*\d+(?:\.\d+)*)*", re.IGNORECASE)
_ANNEX_BRACKET_RE = re.compile(r"\s*[\(\[]\s*(?:Annex\s*)?[A-Z]?\.?\d+(?:\.\d+)+\s*[\)\]]")
_CTRLREF_ROW_RE = re.compile(r"(?im)^\|\s*Control Reference\s*\|.*\|[ \t]*\r?\n")


def _sanitize(content: str) -> str:
    if not content:
        return content
    s = content.replace("�", "-")            # repair mangled dash/char
    s = _CTRLREF_ROW_RE.sub("", s)                # drop 'Control Reference' metadata rows
    s = _CLAUSE_RE.sub("", s)                     # 'Clause 5.1', 'Clauses 6.1 and 6.2' → removed
    s = _ANNEX_BRACKET_RE.sub("", s)              # '(A.5.9)', '[5.1.2]' → removed
    s = re.sub(r"\(\s*\)", "", s)                 # empty parens left behind
    s = re.sub(r"[ \t]{2,}", " ", s)              # collapse doubled spaces
    s = re.sub(r"[ \t]+([.,;:])", r"\1", s)       # space before punctuation
    return s


def generate_one(client, fw_name: str, art: dict, model: str) -> dict:
    """Generate one artifact in the mode that suits its catalog `format`.

    Returns {content, content_format, table}. Reasoning models (gpt-5.x/o-series)
    get a big token budget (they split it with hidden reasoning → empty otherwise).
    """
    atype = art.get("type", "Document")
    fmt = art.get("format", "") or ""
    name = art.get("name", "")
    cref = art.get("control_ref", "")
    desc = art.get("description", "")
    mode = _content_mode(fmt, atype)
    is_reasoning = model.lower().startswith(("gpt-5", "o1", "o3", "o4"))
    max_toks = 16000 if is_reasoning else 4000

    if mode == "table":
        resp = client.chat.completions.create(
            model=model, temperature=0.4, max_tokens=max_toks,
            messages=[{"role": "system", "content": _SYS_TABLE},
                      {"role": "user", "content": _prompt_table(fw_name, name, atype, cref, desc, fmt)}],
        )
        raw = _strip_fences(resp.choices[0].message.content)
        try:
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {}
        cols = data.get("columns") or []
        example_rows = data.get("example_rows") or data.get("rows") or []
        fg = data.get("field_guidance") or {}
        maint = data.get("maintenance") or ""
        if not cols:
            fr = getattr(resp.choices[0], "finish_reason", "?")
            raise RuntimeError(f"empty/invalid template JSON — no columns (finish_reason={fr})")
        return {
            "content": _sanitize(_render_table_md(name, cols, example_rows, fg, maint, fmt)),
            "content_format": "table",
            "table": {"columns": cols, "field_guidance": fg, "example_rows": example_rows,
                      "maintenance": maint, "format": fmt},
        }

    if mode == "guide":
        prompt = _prompt_guide(fw_name, name, atype, cref, desc, fmt)
        return {"content": _sanitize(_call_md(client, model, _SYS, prompt, max_toks)), "content_format": "guide", "table": None}

    # markdown (authored document)
    _key, sections = _skeleton(atype)
    prompt = _prompt(fw_name, name, atype, cref, desc, sections)
    return {"content": _sanitize(_call_md(client, model, _SYS, prompt, max_toks)), "content_format": "markdown", "table": None}


def _is_current(existing: dict, art: dict) -> bool:
    """An entry is up-to-date only if it has content AND was generated in the
    mode the artifact's `format` now calls for. Legacy entries (no content_format)
    count as 'markdown', so doc-types stay, but tabular/system ones get upgraded."""
    if not existing or not existing.get("content"):
        return False
    desired = _content_mode(art.get("format"), art.get("type"))
    return (existing.get("content_format") or "markdown") == desired


def main() -> None:
    ap = argparse.ArgumentParser(description="Pre-generate artifact document content (one-time, resumable).")
    ap.add_argument("--framework", help="Only this framework_key")
    ap.add_argument("--type", help="Only this artifact type (e.g. Charter)")
    ap.add_argument("--limit", type=int, default=0, help="Cap generations this run (0 = all)")
    ap.add_argument("--force", action="store_true", help="Regenerate even if already present")
    ap.add_argument("--sanitize", action="store_true",
                    help="Clean clause/control-reference citations from EXISTING content in place (no AI, no regeneration)")
    # Default to the platform's latest model (gpt-5.5 via get_openai_model()).
    # NOTE: gpt-5.x reasoning models are far slower here (~2-3 min/doc vs ~12s for
    # gpt-4o) because reasoning tokens count against the budget — we give them a
    # 16000-token budget so output is never starved. Override for speed with
    # `--model gpt-4o` or the ARTIFACT_GEN_MODEL env var.
    ap.add_argument("--model", default=os.environ.get("ARTIFACT_GEN_MODEL") or get_openai_model())
    args = ap.parse_args()

    # ── --sanitize: clean existing content in place, no AI needed ──────────────
    if args.sanitize:
        if not _CONTENT.exists():
            raise SystemExit(f"No content file at {_CONTENT} — nothing to sanitize.")
        content = json.loads(_CONTENT.read_text(encoding="utf-8"))
        changed = 0
        for fw_key, arts in content.items():
            if args.framework and fw_key != args.framework:
                continue
            for aid, e in arts.items():
                if not isinstance(e, dict):
                    continue
                c = e.get("content") or ""
                nc = _sanitize(c)
                if nc != c:
                    e["content"] = nc
                    changed += 1
        _CONTENT.write_text(json.dumps(content, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[sanitize] cleaned {changed} of {sum(len(v) for v in content.values())} entr"
              f"{'y' if changed == 1 else 'ies'} in {_CONTENT}", flush=True)
        return

    if not _ai_available():
        raise SystemExit("No usable OpenAI key — set AI_INTEGRATIONS_OPENAI_API_KEY / OPENAI_API_KEY in backend/.env")

    catalog = json.loads(_CATALOG.read_text(encoding="utf-8"))
    content = json.loads(_CONTENT.read_text(encoding="utf-8")) if _CONTENT.exists() else {}
    client = _client()

    def _wanted(fw_key: str, art: dict) -> bool:
        if args.framework and fw_key != args.framework:
            return False
        if not art.get("artifact_id"):
            return False
        if args.type and (art.get("type", "").strip().lower() != args.type.strip().lower()):
            return False
        return True

    # Pre-count what this run will generate, so progress can show [done/total].
    to_do = 0
    for fw_key, fw in catalog.items():
        for art in fw.get("artifacts", []):
            if not _wanted(fw_key, art):
                continue
            aid = art["artifact_id"]
            if not args.force and _is_current(content.get(fw_key, {}).get(aid, {}), art):
                continue
            to_do += 1
    if args.limit:
        to_do = min(to_do, args.limit)
    print(f"[artifact-gen] model={args.model} | to generate this run: {to_do} "
          f"(already done: {sum(len(v) for v in content.values())}/922)", flush=True)

    total = done = skipped = failed = 0
    for fw_key, fw in catalog.items():
        if args.framework and fw_key != args.framework:
            continue
        fw_name = fw.get("name", fw_key)
        bucket = content.setdefault(fw_key, {})
        for art in fw.get("artifacts", []):
            aid = art.get("artifact_id")
            if not aid:
                continue
            if args.type and (art.get("type", "").strip().lower() != args.type.strip().lower()):
                continue
            total += 1
            if not args.force and _is_current(bucket.get(aid, {}), art):
                skipped += 1
                continue
            if args.limit and done >= args.limit:
                continue
            try:
                res = generate_one(client, fw_name, art, args.model)
                bucket[aid] = {
                    "title": art.get("name"), "type": art.get("type"),
                    "control_ref": art.get("control_ref"), "format": art.get("format"),
                    "content": res["content"], "content_format": res["content_format"],
                    "table": res.get("table"),
                    "model": args.model, "generated_at": datetime.utcnow().isoformat(),
                }
                done += 1
                # Persist incrementally so the run is resumable.
                _CONTENT.write_text(json.dumps(content, ensure_ascii=False, indent=1), encoding="utf-8")
                print(f"[{done}/{to_do}] {fw_key}/{aid} ({art.get('type')} → {res['content_format']}) — "
                      f"{(art.get('name') or '')[:55]}", flush=True)
                time.sleep(0.4)  # gentle pacing
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print(f"[FAIL] {fw_key}/{aid}: {exc}", file=sys.stderr, flush=True)

    print(f"\nDone. generated={done} skipped(existing)={skipped} failed={failed} considered={total}", flush=True)
    print(f"Content written to {_CONTENT}", flush=True)


if __name__ == "__main__":
    main()
