"""CTEM Validate — context-based AI control mapping (owner-approved design,
docs/CTEM_CONTEXT_MAPPING_BUILD_PLAN.md).

The AI maps ONE vulnerability finding against the tenant's LOCKED Unified
Control Library — 2,332 controls (426 group leads + 1,906 standalone) wrapping
all 3,419 original framework controls. No regex, no keyword filters, nothing
hidden: for every finding the AI reads EVERY control's name + full description
and decides by context alone.

Two rounds per finding:

  ROUND 1 (scan): the whole corpus, in chapters (packed by char budget, read in
  parallel). Each chapter returns the ids whose statement contextually addresses
  this weakness. No fixed count — whatever matches. A chapter failure aborts the
  finding (a partial scan would silently hide part of the library).

  ROUND 2 (judge): the flagged controls' full statements vs the finding's full
  story (scanner text, official CVE description, CWE meaning, severity,
  exploited-in-the-wild signals, asset context). Output: suggestions with
  CALIBRATED confidence + one-sentence reason — or an honest
  no_specific_control_reason ("patch-only" / "pure inventory note").

Guard rails kept: temperature 0, strict JSON, the model may only answer with
ids it was shown (anything else is dropped and logged), and the full round-2
prompt + raw output are stored on the proposal for audit.

Group semantics live in the caller (ai_control_proposals): a suggestion whose
control is a GROUP lead is fanned out to the group's original framework
controls on link; standalone suggestions link alone.
"""

import contextvars
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PROMPT_VERSION = "p6-ctx-2.0"

# Chapter packing budget, in characters (~11k tokens). Big enough that the whole
# corpus fits in ~15-20 chapters, small enough that the model actually reads
# every line instead of skimming one giant scroll.
_CHAPTER_BUDGET = 45_000
_STATEMENT_CAP = 1_000          # cap pathological outliers, keep normal statements whole
_SCAN_WORKERS = 6


def bucket_for(vuln) -> str:
    """Column check only (no regex): a finding with a CVE/CWE id is 'cve';
    anything else is a described weakness until the model says otherwise."""
    if (getattr(vuln, "cve_id", None) or "").strip() or (getattr(vuln, "cwe_id", None) or "").strip():
        return "cve"
    return "described_weakness"


# ── corpus ────────────────────────────────────────────────────────────────────
def baseline_run_id(db: Session) -> Optional[int]:
    """The locked library's normalization session: is_baseline, newest wins
    (run 47 on the live tenant). None (sqlite unit fixtures / fresh tenants)
    means: no run filter — every NormalizedControl row is the corpus."""
    try:
        from ..models import NormalizationRun
        row = db.query(NormalizationRun.id).filter(
            NormalizationRun.is_baseline == True  # noqa: E712
        ).order_by(NormalizationRun.id.desc()).first()
        return row[0] if row else None
    except Exception:
        return None


def load_corpus(db: Session, tenant_id: Optional[int]) -> List[Dict[str, Any]]:
    """The complete search corpus, deterministic order:

      * every locked-library control (426 group leads + 1,906 standalone on the
        live tenant) with its FULL statement and how many original framework
        controls it wraps (`members`);
      * plus any active, tenant-visible original control NOT yet absorbed by
        the locked library (standalone leftovers from a framework uploaded
        after the lock — empty today, self-filling by design).

    Junk is excluded by construction: duplicate/old normalization sessions
    (non-baseline run_ids) and already-absorbed raw controls never appear."""
    from ..models import (NormalizedControl, NormalizedControlLink,
                          ParsedFrameworkControl, UploadedFramework)
    run = baseline_run_id(db)

    q = db.query(NormalizedControl.id, NormalizedControl.code, NormalizedControl.name,
                 NormalizedControl.domain, NormalizedControl.statement)
    if run is not None:
        q = q.filter(NormalizedControl.run_id == run)
    corpus: List[Dict[str, Any]] = [
        {"kind": "normalized_control", "ref_id": r.id, "code": r.code or "", "title": r.name or "",
         "domain": r.domain or "", "framework": "Unified Control Library",
         "statement": (r.statement or "")[:_STATEMENT_CAP], "members": 1}
        for r in q.all()
    ]

    # group sizes (how many originals each control wraps) — display + audit only
    absorbed_parsed_ids: set = set()
    try:
        nc_ids = [c["ref_id"] for c in corpus]
        if nc_ids:
            sizes: Dict[int, int] = {}
            for nc_id, pid in db.query(NormalizedControlLink.normalized_control_id,
                                       NormalizedControlLink.parsed_control_id).filter(
                    NormalizedControlLink.normalized_control_id.in_(nc_ids),
                    NormalizedControlLink.parsed_control_id.isnot(None)).all():
                sizes[nc_id] = sizes.get(nc_id, 0) + 1
                absorbed_parsed_ids.add(pid)
            for c in corpus:
                c["members"] = sizes.get(c["ref_id"], 1)
    except Exception:
        logger.exception("load_corpus: group sizes unavailable (non-fatal)")

    # standalone leftovers: raw controls the locked library has not absorbed yet
    if run is not None and tenant_id is not None:
        try:
            from sqlalchemy import or_, func
            code_col = func.coalesce(ParsedFrameworkControl.original_reference, ParsedFrameworkControl.control_id)
            q2 = db.query(ParsedFrameworkControl.id, code_col.label("code"), ParsedFrameworkControl.title,
                          ParsedFrameworkControl.domain, ParsedFrameworkControl.description,
                          ParsedFrameworkControl.full_text, UploadedFramework.name.label("fw")
                          ).join(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id
                          ).filter(UploadedFramework.is_active == True,  # noqa: E712
                                   or_(UploadedFramework.tenant_id == tenant_id,
                                       UploadedFramework.is_shared == True))  # noqa: E712
            if absorbed_parsed_ids:
                q2 = q2.filter(~ParsedFrameworkControl.id.in_(absorbed_parsed_ids))
            corpus += [
                {"kind": "parsed_framework_control", "ref_id": r.id, "code": r.code or "", "title": r.title or "",
                 "domain": r.domain or "", "framework": r.fw or "",
                 "statement": ((r.description or r.full_text or ""))[:_STATEMENT_CAP], "members": 1}
                for r in q2.all()
            ]
        except Exception:
            logger.exception("load_corpus: standalone-leftover scan unavailable (non-fatal)")

    corpus.sort(key=lambda c: (c["kind"], c["ref_id"]))
    for i, c in enumerate(corpus, start=1):
        c["id"] = i                              # prompt-local id, stable for this call
    return corpus


def _line(c: Dict[str, Any]) -> str:
    return f"  {c['id']} | {c['code']} | {c['title']} | {c['domain']} | {c['statement']}"


def _chapters(corpus: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """Pack the corpus into chapters under the char budget, preserving order."""
    chapters: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = []
    size = 0
    for c in corpus:
        n = len(_line(c)) + 1
        if cur and size + n > _CHAPTER_BUDGET:
            chapters.append(cur)
            cur, size = [], 0
        cur.append(c)
        size += n
    if cur:
        chapters.append(cur)
    return chapters


# ── prompts ───────────────────────────────────────────────────────────────────
SCAN_SYSTEM_PROMPT = """You are a security-controls analyst. You receive ONE vulnerability finding and ONE CHAPTER of the organisation's control library (columns: id | code | title | domain | statement).

Flag every control in this chapter whose statement, understood in CONTEXT, would prevent, detect, or limit THIS specific weakness. Judge by what the control MEANS, never by shared words. Be inclusive at this stage — a later step makes the strict final judgement — but do not flag controls whose subject matter is unrelated to this weakness class.

If the finding is a pure inventory/informational note — a bare LISTING of facts with nothing stated as wrong (software installed, hardware described, environment variables or cached/history data listed, typed URLs, a name or time reported) — flag nothing. But a HARDENING weakness is NOT inventory: the finding states something is enabled, exposed, reachable or misconfigured that increases attack surface — weak permissions or ACLs on files/services/registry, a protection feature disabled, a risky policy setting (e.g. a permissive execution policy), a legacy protocol allowed, anonymous access, signing not required. For those, DO flag the secure-configuration / least-privilege / hardening / access-control / policy controls that would address them.

Return STRICT JSON only: {"candidate_ids": [<int>, ...]} — ids ONLY from this chapter. Empty list if nothing fits."""

JUDGE_SYSTEM_PROMPT = """You are a security-controls analyst helping a GRC team. You map ONE vulnerability finding to the SPECIFIC security controls, drawn ONLY from the flagged candidate list provided, that would address the weakness it describes.

Hard rules:
- Choose ONLY from the candidate controls given (by their numeric id). Never invent a control. If none genuinely addresses this weakness, return an empty list.
- A control marked "wraps N original framework controls" is a GROUP: choosing it links the whole group. Judge it by its statement exactly like any other control.
- Generic patch-management / vulnerability-management / vulnerability-scanning controls apply to EVERY finding with a CVE — do NOT select them, including any control whose statement is essentially "install updates / keep software patched / upgrade versions". A CVE-bearing finding with no weakness-specific control must return an empty list with no_specific_control_reason saying the remediation is patching.
- Every suggestion must have: control_id (int, from the candidates), confidence (high|medium|low), reason (ONE sentence that names the weakness and why this control addresses it), driven_by (cve_description|cwe|finding_description).
- Confidence is CALIBRATED, not enthusiasm: "high" = the control's own statement names this exact weakness class or mechanism; "medium" = the control covers the right security domain and would materially mitigate it, but is broader or adjacent to the precise fix; "low" = plausible but indirect. Never mark a broad or adjacent control "high".
- Be conservative. A wrong link is worse than a missing one. Prefer 1-4 strong suggestions over many weak ones.
- Prefer the control whose statement most SPECIFICALLY addresses the weakness MECHANISM (input validation for injection, cipher policy for weak TLS, least privilege for weak ACLs). Choose a generic "harden system configurations"-style control only when nothing more specific was flagged — and never for a pure fact-report.
- The control's STATED SCOPE must actually cover the weakness's threat model. If no candidate's scope covers it, return empty and say the library lacks a control for this — do NOT stretch to the nearest-sounding control. Canonical example: classical cryptography standards / key-length controls do NOT address QUANTUM threats (post-quantum readiness, harvest-now-decrypt-later) — Shor's algorithm breaks RSA/ECC at any key length; only an explicit post-quantum-cryptography control covers those.
- Authentication BYPASS weaknesses (a check skipped via an alternate name, path or channel) are logic/validation flaws: multi-factor authentication and password-policy controls do NOT address them. Map them to input validation / canonicalisation, access-control ENFORCEMENT, session management or secure-coding controls instead.
- Distinguish two kinds of no-CVE findings:
  (a) A pure INVENTORY note — a bare listing of facts with nothing stated as wrong (installed software, environment variables, cached/history data, typed URLs, boot times, hardware info). Return an empty list and say so in no_specific_control_reason (use the words "pure inventory note") — even if candidate controls were flagged.
  (b) A HARDENING weakness — something enabled, exposed, reachable, or configured that increases attack surface: weak or insecure permissions/ACLs on files, services or registry keys, a protection feature disabled, a permissive execution policy, a legacy protocol allowed, anonymous access, signing not required. These ARE weaknesses; map them to secure-configuration / least-functionality / least-privilege / hardening / access-control controls. Do NOT call them informational.
- Output STRICT JSON only, matching the schema. No prose, no markdown."""


def _vuln_context(vuln, *, cwe_name: Optional[str], nvd_description: Optional[str]) -> str:
    return f"""FINDING
  title: {getattr(vuln, 'title', '') or ''}
  cve_id: {getattr(vuln, 'cve_id', None) or 'none'}
  cwe: {getattr(vuln, 'cwe_id', None) or 'none'} — {cwe_name or 'unknown'}
  cvss_vector: {getattr(vuln, 'cvss_vector', None) or 'none'}
  severity: {getattr(vuln, 'severity', None) or 'unknown'}
  scanner_description: {(getattr(vuln, 'description', None) or '')[:1200]}
  cve_description (NVD): {(nvd_description or 'n/a')[:800]}
  epss: {getattr(vuln, 'epss_score', None) if getattr(vuln, 'epss_score', None) is not None else 'n/a'}   in_kev: {bool(getattr(vuln, 'kev_flag', False))}"""


def build_judge_prompt(vuln, candidates: List[Dict[str, Any]], *, cwe_name: Optional[str],
                       nvd_description: Optional[str], asset_type: Optional[str],
                       internet_facing: Optional[bool]) -> str:
    cand_lines = "\n".join(
        f"  {c['id']} | {c['code']} | {c['title']} | {c['domain']} | wraps {c.get('members', 1)} original framework control(s) | {c['statement']}"
        for c in candidates
    ) or "  (none were flagged in the full-library scan)"
    return f"""{_vuln_context(vuln, cwe_name=cwe_name, nvd_description=nvd_description)}
  asset_context: {asset_type or 'unknown'}, internet_facing={internet_facing if internet_facing is not None else 'unknown'}

FLAGGED CANDIDATE CONTROLS (the full library was scanned; these matched by context — choose only from these ids)
{cand_lines}

Return JSON:
{{"suggestions":[{{"control_id":<int>,"confidence":"high|medium|low","reason":"<one sentence>","driven_by":"cve_description|cwe|finding_description"}}],"no_specific_control_reason":"<only if suggestions is empty>"}}"""


# ── the two rounds ────────────────────────────────────────────────────────────
def _chat(client, model: str, system: str, user: str) -> str:
    resp = client.chat.completions.create(
        model=model, temperature=0, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": user}],
    )
    return resp.choices[0].message.content or "{}"


def _scan_chapter(client, model: str, context: str, chapter: List[Dict[str, Any]],
                  k: int, total: int) -> List[int]:
    """One chapter of round 1. Retries once; raises on second failure — a
    silently-skipped chapter would hide part of the library."""
    user = f"{context}\n\nCHAPTER {k}/{total} OF THE CONTROL LIBRARY (id | code | title | domain | statement)\n" + \
           "\n".join(_line(c) for c in chapter)
    own_ids = {c["id"] for c in chapter}
    last_err: Optional[Exception] = None
    for _ in range(2):
        try:
            raw = _chat(client, model, SCAN_SYSTEM_PROMPT, user)
            parsed = json.loads(raw)
            ids = []
            for v in parsed.get("candidate_ids") or []:
                try:
                    i = int(v)
                except Exception:
                    continue
                if i in own_ids:                  # a chapter may only flag its own lines
                    ids.append(i)
            return ids
        except Exception as e:                    # noqa: PERF203
            last_err = e
    raise RuntimeError(f"library scan failed on chapter {k}/{total}: {type(last_err).__name__}")


def suggest_controls(db: Session, vuln, *, asset=None, cwe_name: Optional[str] = None,
                     nvd_description: Optional[str] = None, client=None,
                     model: Optional[str] = None) -> Dict[str, Any]:
    """Full-corpus context mapping for one finding. Never links (the caller
    decides). Never raises on model failure (returns error in the dict)."""
    bucket = bucket_for(vuln)
    if cwe_name is None and getattr(vuln, "cwe_id", None):
        try:
            from ..modules.vuln_management.attack.cwe_hierarchy import name as _cwe_name
            cwe_name = _cwe_name(getattr(vuln, "cwe_id", None))
        except Exception:
            cwe_name = None

    out: Dict[str, Any] = {"vulnerability_id": getattr(vuln, "id", None), "bucket": bucket,
                           "prompt_version": PROMPT_VERSION, "suggestions": [],
                           "dropped_invalid_ids": [], "candidates": 0}

    corpus = load_corpus(db, getattr(vuln, "tenant_id", None))
    out["corpus_size"] = len(corpus)
    if not corpus:
        out["no_specific_control_reason"] = "the control library is empty — nothing to map against"
        return out

    try:
        if client is None:
            from ..modules.control_library.routers.groups import get_openai_client
            client = get_openai_client()
        if model is None:
            from ..config import get_openai_model
            model = get_openai_model()
    except Exception as e:
        out["error"] = f"model client unavailable: {type(e).__name__}"
        return out

    context = _vuln_context(vuln, cwe_name=cwe_name, nvd_description=nvd_description)
    chapters = _chapters(corpus)

    # ROUND 1 — read the whole library, in parallel chapters. Each task runs in a
    # COPY of the caller's contextvars context, so the usage-tracking scope
    # (tenant attribution) survives the thread hop — without this, every chapter
    # call's usage event is dropped ("no tenant context resolved").
    try:
        with ThreadPoolExecutor(max_workers=min(_SCAN_WORKERS, len(chapters))) as ex:
            futures = [ex.submit(contextvars.copy_context().run, _scan_chapter,
                                 client, model, context, ch, k + 1, len(chapters))
                       for k, ch in enumerate(chapters)]
            flagged_ids: List[int] = []
            for f in futures:
                flagged_ids.extend(f.result())
    except Exception as e:
        logger.exception("ai_control_mapping: library scan failed for vuln %s", getattr(vuln, "id", "?"))
        out["error"] = str(e) if isinstance(e, RuntimeError) else f"library scan failed: {type(e).__name__}"
        return out

    flagged_ids = sorted(set(flagged_ids))
    by_id = {c["id"]: c for c in corpus}
    candidates = [by_id[i] for i in flagged_ids]
    out["candidates"] = len(candidates)

    # ROUND 2 — final judgement over the flagged controls (or the honest "none")
    internet_facing = None
    if asset is not None:
        _a, _b = getattr(asset, "is_internet_facing", None), getattr(asset, "internet_facing", None)
        internet_facing = True if (_a or _b) else (None if (_a is None and _b is None) else False)
    user_prompt = build_judge_prompt(vuln, candidates, cwe_name=cwe_name, nvd_description=nvd_description,
                                     asset_type=getattr(asset, "asset_type", None) if asset else None,
                                     internet_facing=internet_facing)
    out["prompt"] = {"system": JUDGE_SYSTEM_PROMPT, "user": user_prompt,
                     "round1": {"system": SCAN_SYSTEM_PROMPT, "chapters": len(chapters),
                                "corpus_size": len(corpus), "flagged_local_ids": flagged_ids}}

    try:
        raw = _chat(client, model, JUDGE_SYSTEM_PROMPT, user_prompt)
    except Exception as e:
        logger.exception("ai_control_mapping: judge call failed for vuln %s", getattr(vuln, "id", "?"))
        out["error"] = f"model call failed: {type(e).__name__}"
        return out

    out["raw_output"] = raw
    try:
        parsed = json.loads(raw)
    except Exception:
        out["error"] = "model returned non-JSON"
        return out

    allowed = set(flagged_ids)
    for s in parsed.get("suggestions") or []:
        try:
            cid = int(s.get("control_id"))
        except Exception:
            continue
        if cid not in allowed:                    # the guard: never trust an id we didn't offer
            out["dropped_invalid_ids"].append(cid)
            continue
        conf = str(s.get("confidence", "low")).lower()
        if conf not in ("high", "medium", "low"):
            conf = "low"
        c = by_id[cid]
        out["suggestions"].append({
            # `control_id` = the REAL row id of the chosen kind; `kind` says which
            # table it lives in. The prompt-local id never leaves this module.
            "control_id": c["ref_id"], "kind": c["kind"], "framework": c.get("framework", ""),
            "code": c["code"], "title": c["title"], "domain": c["domain"],
            "members": c.get("members", 1), "confidence": conf,
            "reason": str(s.get("reason", ""))[:400],
            "driven_by": str(s.get("driven_by", ""))[:40],
        })
    if not out["suggestions"]:
        out["no_specific_control_reason"] = parsed.get("no_specific_control_reason") or "model found no specific control"
    return out
