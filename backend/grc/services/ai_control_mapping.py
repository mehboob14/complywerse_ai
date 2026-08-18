"""P5 — AI-suggested SPECIFIC control mapping over the Unified Control Library.

The rule-based crosswalk (cwe_control_map) links every open CVE to the GENERAL
patch/vuln-management controls — correct but shallow. This service proposes the
SPECIFIC controls that address a finding's actual weakness, drawn ONLY from the
tenant's own normalized control library, for a human to approve.

Design (agreed 16 Aug, prompt battle-tested against real findings — see
docs/CTEM_P5_AI_MAPPING_PROMPT.md and tests/test_ai_control_mapping.py):

  * Three buckets, decided BEFORE any model call: (1) has CVE/CWE → map with
    full context; (2) no CVE but the description states a real weakness → map
    from text, lower confidence; (3) inventory note ("X installed", "OS
    identified") → NOT sent, labelled informational. Bucket 3 costs nothing and
    never pollutes results.
  * Candidates are a pre-filtered SHORTLIST of the tenant's normalized controls
    (keyword/domain relevance), passed by id. The model may choose ONLY from
    that list — it cannot name a control that doesn't exist. Every returned id
    is re-validated against the shortlist; anything else is dropped and logged.
  * Suggest, never link. Output is a proposal with confidence + a one-sentence
    reason + which input drove it. "None" is a valid answer.
  * temperature 0, strict JSON, the whole prompt input + raw output stored on
    the proposal so every suggestion is auditable later.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import or_, func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PROMPT_VERSION = "p5-map-1.5"

# ── bucket classifier ─────────────────────────────────────────────────────────
# Titles that are pure inventory / detection notes: facts about the machine, not
# weaknesses. Conservative on purpose — a miss here just means one more model
# call, a false "inventory" tag would silently hide a real weakness. Patterns
# are matched against the TITLE only.
_INVENTORY_PATTERNS = [
    r"\binstalled\b", r"\bdetection\b", r"\bidentification\b", r"\benumerat",
    r"\binformation\b", r"\bversion\b(?!.*(vulnerab|outdated|unsupported|end.of.life))",
    r"\blogged.on users\b", r"\bmanufacturer\b", r"\bregistry service\b",
    r"\bcredential status\b", r"\bnessus (scan|sysinfo|windows)", r"\bscan information\b",
    r"\bcommon platform enumeration\b", r"\bdevice type\b", r"\bhostname\b",
    r"\bip assignment\b", r"\btraceroute\b", r"\bping\b", r"\buptime\b",
    r"\bsoftware enumeration\b", r"\bpatch assessment\b", r"\bauthentication (success|protocol)\b",
    # learned from the 16 Aug battery — Windows forensic/inventory notes:
    r"\bhistory\b", r"\brecycle bin\b", r"\bprefetch\b", r"\bportable devices\b",
    r"\b(dialects|versions) supported\b", r"\bscripting host settings\b", r"\bstart menu\b",
    r"\bnetstat\b", r"\bnetwork interfaces\b", r"\bshares? enumeration\b", r"\bservice (config|enumeration)\b",
    r"\bnativelanmanager\b", r"\blsaquery", r"\bsystem information\b", r"\bproduct key\b",
    r"\bfile version\b", r"\bdisplay driver\b", r"\bbios\b", r"\bprocessor\b", r"\bmemory information\b",
]
# Titles that DESCRIBE a weakness even without a CVE — these go to the model.
_WEAKNESS_HINTS = [
    r"\bweak\b", r"\bdeprecated\b", r"\bunsupported\b", r"\bend.of.life\b", r"\bobsolete\b",
    r"\bremotely accessible\b", r"\banonymous\b", r"\bunauthenticated\b", r"\bnull session\b",
    r"\bcleartext\b", r"\bplaintext\b", r"\bself.signed\b", r"\bexpired\b", r"\bsigning (not|disabled)\b",
    r"\bnot required\b", r"\bdisabled\b", r"\bmisconfig", r"\binsecure\b", r"\bdefault (password|credential)",
    r"\btls\b.*\b1\.[01]\b", r"\bsslv[23]\b", r"\brc4\b", r"\bmd5\b", r"\bsha-?1\b",
    r"\bvulnerab", r"\boverflow\b", r"\binjection\b", r"\btraversal\b", r"\bbypass\b",
    # real flaws whose titles carry an inventory-looking word (caught by the test
    # battery — "Unquoted Service Path Enumeration" is CWE-428 priv-esc, not inventory)
    r"\bunquoted\b", r"\bprivilege\b", r"\bescalat", r"\bcannot be trusted\b", r"\bcached password\b",
    r"\bmacros?\b", r"\bexecution policy\b", r"\bregistry acl\b", r"\bdllsearch\b",
]


def classify_finding(vuln) -> Tuple[str, str]:
    """→ (bucket, reason). bucket ∈ {"cve", "described_weakness", "inventory"}."""
    cve = (getattr(vuln, "cve_id", None) or "").strip()
    cwe = (getattr(vuln, "cwe_id", None) or "").strip()
    if cve or cwe:
        return "cve", "carries a CVE/CWE — full context for mapping"
    title = (getattr(vuln, "title", None) or "").lower()
    if any(re.search(p, title) for p in _WEAKNESS_HINTS):
        return "described_weakness", "no CVE, but the title/description states a real weakness"
    if any(re.search(p, title) for p in _INVENTORY_PATTERNS):
        return "inventory", "informational — a fact about the machine, no weakness to map"
    # Unknown shape: send it (a model call is cheaper than a hidden weakness).
    return "described_weakness", "no CVE; shape unclear — sent to the model to decide"


# ── candidate shortlist ───────────────────────────────────────────────────────
# Keywords per weakness class → pulled from CWE name / title / description. The
# shortlist is what bounds the model: it can only pick from these ids.
_STOP = {"the", "a", "an", "of", "in", "on", "for", "and", "or", "to", "with", "by", "is",
         "are", "be", "as", "at", "from", "that", "this", "it", "its", "via", "using", "over",
         "multiple", "vulnerabilities", "vulnerability", "remote", "windows", "microsoft",
         "module", "server", "client", "version", "versions", "prior", "later", "than", "less",
         "detected", "detection", "installed", "cve", "cwe", "x", "n/a"}


def _keywords(*texts: Optional[str], limit: int = 14) -> List[str]:
    seen: List[str] = []
    for t in texts:
        for w in re.findall(r"[a-zA-Z][a-zA-Z\-]{3,}", (t or "").lower()):
            if w in _STOP or w in seen:
                continue
            seen.append(w)
            if len(seen) >= limit:
                return seen
    return seen


# Weakness-CONCEPT expander (iteration 2 fix). Title words alone missed the
# right controls: "WinVerifyTrust Signature Validation Mitigation" surfaced
# nothing about code-signing/integrity, so the model — correctly bound to the
# shortlist — could only say "none". The shortlist must be built from what the
# weakness MEANS. Keyed on CWE id and on concept words in the title/description;
# values are the control-vocabulary synonyms to search the library with.
_CONCEPTS: List[Tuple[re.Pattern, List[str]]] = [
    (re.compile(r"cwe-?(20|1287|1284|129|1286)\b|input validation|improper validation"), ["input validation", "data validation", "validation checks", "sanitiz"]),
    (re.compile(r"cwe-?(89|564)\b|sql injection"), ["input validation", "parameteri", "database security", "secure coding"]),
    (re.compile(r"cwe-?(79|80)\b|cross.site scripting|xss"), ["input validation", "output encoding", "secure coding", "web application"]),
    (re.compile(r"cwe-?(78|77)\b|command injection"), ["input validation", "secure coding", "least privilege"]),
    (re.compile(r"cwe-?(22|23|36)\b|path traversal|directory traversal|arbitrary file"), ["input validation", "file integrity", "access control", "least privilege"]),
    (re.compile(r"cwe-?(119|120|121|122|125|787|416|190)\b|buffer overflow|heap|out.of.bounds|memory corruption|use.after.free"), ["memory protection", "secure coding", "application whitelisting", "endpoint protection", "exploit mitigation"]),
    (re.compile(r"cwe-?(347|295|296|297|345|494|506)\b|signature|code.?sign|winverifytrust|authenticode|integrity of (application|software|message)|tamper"), ["code signing", "software integrity", "authenticity and integrity", "digital signature", "trusted software", "application whitelisting"]),
    (re.compile(r"cwe-?(326|327|328|310|311|319|321|798)\b|weak (cipher|encryption|crypto)|tls\b|ssl\b|rc4|md5|sha-?1|cleartext|plaintext|cipher"), ["cryptograph", "cipher suite", "encryption in transit", "tls", "protocol", "key management"]),
    # auth BYPASS family (CWE-287's logic-flaw children): the weakness is that a check can be
    # SKIPPED via an alternate name / path / channel — MFA and password controls do not
    # address that; canonicalisation, input validation and access-control ENFORCEMENT do.
    # Placed before the generic auth row so these terms lead the shortlist (live battery
    # 18 Aug: CWE-289 was mapped to MFA at "high" — the iteration-2 decoy pattern again).
    (re.compile(r"cwe-?(288|289|290|302|305|294|1390)\b|authentication bypass|bypass by|alternate (name|path|channel)"), ["access control", "authorization", "input validation", "data validation", "canonical", "session management", "secure coding"]),
    (re.compile(r"cwe-?(287|306|287|307|308|522|521|1391)\b|authentication|null session|anonymous|unauthenticated|password"), ["authentication", "multi-factor", "password", "credential", "account"]),
    (re.compile(r"cwe-?(269|250|266|284|285|732|276)\b|privilege|permission|access control|authorization|remotely accessible|share access|log ?in possible"), ["least privilege", "access control", "authorization", "privileged access", "hardening", "remote access"]),
    (re.compile(r"cwe-?(1321|915|502)\b|prototype pollution|deserializ"), ["input validation", "data validation", "validation", "secure coding", "dependency", "third-party component"]),
    # CWE-441/918/601: the app is made to talk to somewhere it shouldn't (SSRF / open proxy /
    # redirect) — the 12-uncovered-CWE battery had NO row for it → zero candidates → never judged
    (re.compile(r"cwe-?(441|918|601)\b|ssrf|server.side request|open proxy|unintended proxy|intermediary|open redirect"), ["input validation", "data validation", "network security", "egress", "access control", "web application", "secure coding"]),
    (re.compile(r"cwe-?(400|770|1333)\b|denial of service|dos\b|rapid reset|resource exhaustion"), ["availability", "resource limit", "denial of service", "capacity", "rate limit"]),
    (re.compile(r"cwe-?(1104|937|1035|1395)\b|outdated|unsupported|end.of.life|obsolete|deprecated"), ["end of life", "unsupported software", "software lifecycle", "asset lifecycle", "secure configuration"]),
    (re.compile(r"service enabled|spooler|unnecessary|listening|open port|remotely accessible|smb|netbios|rdp|telnet|ftp\b"), ["hardening", "least functionality", "unnecessary services", "secure configuration", "baseline configuration", "network security"]),
    (re.compile(r"cwe-?(200|209|532|538)\b|disclosure|information leak|exposes|verbose"), ["information disclosure", "data protection", "logging", "error handling", "secure configuration"]),
]


def _concept_terms(cwe_id: Optional[str], cwe_name: Optional[str], title: Optional[str],
                   description: Optional[str]) -> Tuple[List[str], List[str]]:
    """→ (primary_terms, secondary_terms).

    PRIMARY = concepts triggered by the CWE id / CWE name / TITLE — the
    authoritative statement of what the weakness IS. SECONDARY = concepts
    triggered only by words in the long scanner description. Iteration 3 fix:
    a description mentioning "authentication" in passing fired the auth
    concept and flooded the shortlist with MFA/password controls, pushing the
    real (code-signing) controls out — so the model, correctly bound to the
    list, said "none". Description-only concepts must not outrank the CWE's."""
    strong = " ".join(t or "" for t in (cwe_id, cwe_name, title)).lower()
    weak = (description or "").lower()
    primary: List[str] = []
    secondary: List[str] = []
    for pat, terms in _CONCEPTS:
        if pat.search(strong):
            for t in terms:
                if t not in primary:
                    primary.append(t)
        elif pat.search(weak):
            for t in terms:
                if t not in primary and t not in secondary:
                    secondary.append(t)
    return primary, secondary


def build_candidates(db: Session, vuln, *, cwe_name: Optional[str] = None, max_candidates: int = 40,
                     tenant_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """Relevance-filtered shortlist from the tenant's WHOLE control corpus —
    the Unified Control Library AND the uploaded frameworks (ISO/NIST/PCI/CSF
    parsed controls) — merged and ranked by the same concept scoring. Bounded so
    the prompt stays small and the model cannot pick outside it.

    Built from BOTH weakness-concept synonyms (what the weakness MEANS — the
    fix for iteration 1, where title words missed code-signing controls) AND
    literal title/description keywords, concept terms ranked first.

    Each candidate carries `kind` ('normalized_control' | 'parsed_framework_control')
    and, for framework controls, `framework`; the model sees code+title+statement
    and picks by a prompt-local `id` (1..N) so the two id-spaces cannot collide.
    # ponytail: ILIKE over ~3.5k rows is the index; add pgvector when a tenant's
    # corpus outgrows it or keyword recall measurably misses."""
    from ..models import NormalizedControl, ParsedFrameworkControl, UploadedFramework
    primary, secondary = _concept_terms(getattr(vuln, "cwe_id", None), cwe_name,
                                        getattr(vuln, "title", None), getattr(vuln, "description", None))
    concepts = primary + secondary
    literal = _keywords(cwe_name, getattr(vuln, "title", None), getattr(vuln, "description", None))
    kws = concepts + [k for k in literal if k not in concepts]
    if tenant_id is None:
        tenant_id = getattr(vuln, "tenant_id", None)

    def _like_clauses(*cols):
        cl = []
        for k in kws:
            like = f"%{k}%"
            cl += [c.ilike(like) for c in cols]
        return cl

    # ── source 1: Unified Control Library ──
    q = db.query(NormalizedControl.id, NormalizedControl.code, NormalizedControl.name,
                 NormalizedControl.domain, NormalizedControl.statement)
    if kws:
        q = q.filter(or_(*_like_clauses(NormalizedControl.name, NormalizedControl.statement, NormalizedControl.domain)))
    pool = [{"kind": "normalized_control", "ref_id": r.id, "code": r.code, "title": r.name,
             "domain": r.domain or "", "framework": "Unified Control Library",
             "statement": (r.statement or "")} for r in q.limit(max_candidates * 6).all()]

    # ── source 2: uploaded frameworks visible to this tenant (own + shared, active) ──
    if tenant_id is not None:
        code_col = func.coalesce(ParsedFrameworkControl.original_reference, ParsedFrameworkControl.control_id)
        q2 = db.query(ParsedFrameworkControl.id, code_col.label("code"), ParsedFrameworkControl.title,
                      ParsedFrameworkControl.domain, ParsedFrameworkControl.description,
                      ParsedFrameworkControl.full_text, UploadedFramework.name.label("fw")
                      ).join(UploadedFramework, UploadedFramework.id == ParsedFrameworkControl.uploaded_framework_id
                      ).filter(UploadedFramework.is_active == True,  # noqa: E712
                               or_(UploadedFramework.tenant_id == tenant_id, UploadedFramework.is_shared == True))  # noqa: E712
        if kws:
            q2 = q2.filter(or_(*_like_clauses(ParsedFrameworkControl.title, ParsedFrameworkControl.description,
                                              ParsedFrameworkControl.full_text, ParsedFrameworkControl.domain)))
        pool += [{"kind": "parsed_framework_control", "ref_id": r.id, "code": r.code or "", "title": r.title,
                  "domain": r.domain or "", "framework": r.fw or "",
                  "statement": (r.description or r.full_text or "")} for r in q2.limit(max_candidates * 6).all()]

    # Rank: a concept-term hit in the TITLE weighs most (that's the control's own
    # words for the weakness), then concept hits anywhere, then literal keyword
    # hits. Deterministic tie-break on (kind, ref_id) so the shortlist is reproducible.
    def score(c):
        name = (c["title"] or "").lower()
        hay = f"{name} {c['statement']} {c['domain']}".lower()
        s = 0
        for k in primary:               # the CWE/title's own concept — dominant
            if k in name: s += 10
            elif k in hay: s += 6
        for k in secondary:             # description-only concept — supporting
            if k in name: s += 3
            elif k in hay: s += 2
        for k in literal:
            if k in hay: s += 1
        return s
    pool.sort(key=lambda c: (-score(c), c["kind"], c["ref_id"]))
    out = []
    for i, c in enumerate(pool[:max_candidates], start=1):
        c = dict(c); c["id"] = i; c["statement"] = c["statement"][:220]
        out.append(c)
    return out


# ── the prompt ────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a security-controls analyst helping a GRC team. You map ONE vulnerability finding to the SPECIFIC security controls, drawn ONLY from the candidate list provided, that would address the weakness it describes.

Hard rules:
- Choose ONLY from the candidate controls given (by their numeric id). Never invent a control. If none genuinely addresses this weakness, return an empty list.
- The generic patch-management / vulnerability-management / vulnerability-scanning controls are ALREADY linked by rule. Do NOT suggest them. Suggest only controls that address the SPECIFIC weakness class (e.g. input validation, cryptographic configuration, least privilege, service/protocol hardening, secure configuration baselines, logging/detection of this class of attack).
- Every suggestion must have: control_id (int, from the candidates), confidence (high|medium|low), reason (ONE sentence that names the weakness and why this control addresses it), driven_by (cve_description|cwe|finding_description).
- Be conservative. A wrong link is worse than a missing one. Prefer 1-4 strong suggestions over many weak ones.
- Authentication BYPASS weaknesses (CWE-288/289/290/302/305 — a check skipped via an alternate name, path or channel) are logic/validation flaws: multi-factor authentication and password-policy controls do NOT address them. Map them to input validation / canonicalisation, access-control ENFORCEMENT, session management or secure-coding controls instead.
- Match the control to the WEAKNESS CLASS, not to a word shared with the finding title. Read the control's statement column: if it does not describe something that would prevent, detect or limit this specific weakness, do not choose it.
- Distinguish two kinds of no-CVE findings:
  (a) A pure INVENTORY note — a fact about the machine with nothing wrong (software installed, OS identified, users listed, hardware info). Return an empty list and say so in no_specific_control_reason.
  (b) A HARDENING weakness — something enabled, exposed, reachable, or configured that increases attack surface: an unnecessary service running, a registry/share/interface remotely accessible, a legacy protocol or weak cipher allowed, anonymous/null access, signing not required, a default left on. These ARE weaknesses. Map them to secure-configuration / least-functionality / hardening / access-control controls. Do NOT call them informational.
- Output STRICT JSON only, matching the schema. No prose, no markdown."""


def build_user_prompt(vuln, candidates: List[Dict[str, Any]], *, cwe_name: Optional[str],
                      nvd_description: Optional[str], asset_type: Optional[str],
                      internet_facing: Optional[bool]) -> str:
    cand_lines = "\n".join(
        f"  {c['id']} | {c.get('framework', '')} | {c['code']} | {c['title']} | {c['domain']} | {c['statement']}" for c in candidates
    ) or "  (none)"
    return f"""FINDING
  title: {getattr(vuln, 'title', '') or ''}
  cve_id: {getattr(vuln, 'cve_id', None) or 'none'}
  cwe: {getattr(vuln, 'cwe_id', None) or 'none'} — {cwe_name or 'unknown'}
  cvss_vector: {getattr(vuln, 'cvss_vector', None) or 'none'}
  severity: {getattr(vuln, 'severity', None) or 'unknown'}
  scanner_description: {(getattr(vuln, 'description', None) or '')[:1200]}
  cve_description (NVD): {(nvd_description or 'n/a')[:800]}
  epss: {getattr(vuln, 'epss_score', None) if getattr(vuln, 'epss_score', None) is not None else 'n/a'}   in_kev: {bool(getattr(vuln, 'kev_flag', False))}
  asset_context: {asset_type or 'unknown'}, internet_facing={internet_facing if internet_facing is not None else 'unknown'}

CANDIDATE CONTROLS (choose only from these ids; columns: id | framework | code | title | domain | statement)
{cand_lines}

Return JSON:
{{"suggestions":[{{"control_id":<int>,"confidence":"high|medium|low","reason":"<one sentence>","driven_by":"cve_description|cwe|finding_description"}}],"no_specific_control_reason":"<only if suggestions is empty>"}}"""


# ── the call ──────────────────────────────────────────────────────────────────
def suggest_controls(db: Session, vuln, *, asset=None, cwe_name: Optional[str] = None,
                     nvd_description: Optional[str] = None, client=None, model: Optional[str] = None,
                     max_candidates: int = 40) -> Dict[str, Any]:
    """Classify → shortlist → (maybe) call the model → validate → return a proposal
    dict. Never links. Never raises on model failure (returns error in the dict)."""
    bucket, why = classify_finding(vuln)
    # The CWE NAME (MITRE, e.g. "Improper Verification of Cryptographic Signature")
    # is the single most useful sentence for both the shortlist and the model.
    if cwe_name is None and getattr(vuln, "cwe_id", None):
        try:
            from ..modules.vuln_management.attack.cwe_hierarchy import name as _cwe_name
            cwe_name = _cwe_name(getattr(vuln, "cwe_id", None))
        except Exception:
            cwe_name = None
    out: Dict[str, Any] = {"vulnerability_id": getattr(vuln, "id", None), "bucket": bucket,
                           "bucket_reason": why, "prompt_version": PROMPT_VERSION,
                           "suggestions": [], "dropped_invalid_ids": [], "candidates": 0}
    if bucket == "inventory":
        out["no_specific_control_reason"] = why
        return out

    candidates = build_candidates(db, vuln, cwe_name=cwe_name, max_candidates=max_candidates,
                                  tenant_id=getattr(vuln, "tenant_id", None))
    out["candidates"] = len(candidates)
    if not candidates:
        out["no_specific_control_reason"] = "no relevant candidates found in the control library"
        return out
    allowed = {c["id"] for c in candidates}

    internet_facing = None
    if asset is not None:
        _a, _b = getattr(asset, "is_internet_facing", None), getattr(asset, "internet_facing", None)
        internet_facing = True if (_a or _b) else (None if (_a is None and _b is None) else False)
    user_prompt = build_user_prompt(vuln, candidates, cwe_name=cwe_name, nvd_description=nvd_description,
                                    asset_type=getattr(asset, "asset_type", None) if asset else None,
                                    internet_facing=internet_facing)
    out["prompt"] = {"system": SYSTEM_PROMPT, "user": user_prompt}

    try:
        if client is None:
            from ..modules.control_library.routers.groups import get_openai_client
            client = get_openai_client()
        if model is None:
            from ..config import get_openai_model
            model = get_openai_model()
        resp = client.chat.completions.create(
            model=model, temperature=0, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM_PROMPT},
                      {"role": "user", "content": user_prompt}],
        )
        raw = resp.choices[0].message.content or "{}"
    except Exception as e:  # never raise — the caller decides how to surface
        logger.exception("ai_control_mapping: model call failed for vuln %s", getattr(vuln, "id", "?"))
        out["error"] = f"model call failed: {type(e).__name__}"
        return out

    out["raw_output"] = raw
    try:
        parsed = json.loads(raw)
    except Exception:
        out["error"] = "model returned non-JSON"
        return out

    cand_by_id = {c["id"]: c for c in candidates}
    for s in parsed.get("suggestions") or []:
        try:
            cid = int(s.get("control_id"))
        except Exception:
            continue
        if cid not in allowed:                      # the guard: never trust an id we didn't offer
            out["dropped_invalid_ids"].append(cid)
            continue
        conf = str(s.get("confidence", "low")).lower()
        if conf not in ("high", "medium", "low"):
            conf = "low"
        c = cand_by_id[cid]
        out["suggestions"].append({
            # `control_id` = the REAL row id of the chosen kind (name kept for callers/tests);
            # `kind` says which table it lives in. The prompt-local id never leaves here.
            "control_id": c["ref_id"], "kind": c["kind"], "framework": c.get("framework", ""),
            "code": c["code"], "title": c["title"], "domain": c["domain"], "confidence": conf,
            "reason": str(s.get("reason", ""))[:400],
            "driven_by": str(s.get("driven_by", ""))[:40],
        })
    if not out["suggestions"]:
        out["no_specific_control_reason"] = parsed.get("no_specific_control_reason") or "model found no specific control"
    return out
