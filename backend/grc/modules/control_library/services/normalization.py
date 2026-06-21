"""AI-driven control normalization.

Turns each AI domain (CommonControlGroup) into a small set of NORMALIZED
controls. The controls inside a domain come from many frameworks and often
say the same thing in different words; we cluster them so that one normalized
control consolidates the overlapping requirement across frameworks. Each
normalized control is linked (NormalizedControlLink) to every framework /
parsed control it consolidates — that linkage is what later lets a single
piece of evidence on the normalized control satisfy all of them.

Runs inside the existing `parsing` Celery worker (or its thread fallback),
reporting progress + honouring cancellation via the same job_status contract
used by auto-grouping.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ....models import (
    NormalizedControl,
    NormalizedControlLink,
    CommonControlGroup,
    CommonControlGroupMapping,
    ParsedFrameworkControl,
    FrameworkControl,
    UploadedFramework,
    NormalizationRun,
)
from ....config import get_openai_model
from ..routers.groups import get_openai_client, AutoGroupCancelled

logger = logging.getLogger(__name__)

# Clustering is done BY THE MODEL, not by string matching. We send short
# payloads (name + ~260 chars) so the model can hold a whole domain in context
# and reason about it in ONE call. Only genuinely huge domains are split, and
# even then the partial results are merged by a SECOND AI call (never by regex
# or name matching) so the consolidation decision is always the model's.
_SINGLE_CALL_MAX = 70   # cluster a domain in one AI call when it has <= this many controls
_CHUNK_SIZE = 60        # for larger domains, AI-cluster in chunks, then AI-merge the results
_SHORT_TEXT = 480


# ── Fetch a domain's member controls ─────────────────────────────────────────

def _fetch_domain_members(db: Session, group: CommonControlGroup) -> List[dict]:
    """Return the framework/parsed controls mapped to this domain group as
    short clustering payloads. Skips members that are already normalized."""
    members: List[dict] = []
    mappings = (
        db.query(CommonControlGroupMapping)
        .filter(CommonControlGroupMapping.group_id == group.id)
        .all()
    )
    parsed_ids = [m.parsed_control_id for m in mappings if m.parsed_control_id]
    fw_ids = [m.framework_control_id for m in mappings if m.framework_control_id]

    fw_name_cache: Dict[int, str] = {}

    if parsed_ids:
        parsed = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.id.in_(parsed_ids)
        ).all()
        need = list({p.uploaded_framework_id for p in parsed})
        if need:
            for fw in db.query(UploadedFramework).filter(UploadedFramework.id.in_(need)).all():
                fw_name_cache[fw.id] = fw.name
        for p in parsed:
            text = (p.description or p.full_text or "").strip().replace("\n", " ")
            members.append({
                "ref": "parsed", "ref_id": p.id,
                "framework": fw_name_cache.get(p.uploaded_framework_id, "Unknown"),
                "code": p.original_reference or p.control_id or "",
                "name": (p.title or "")[:200],
                "text": text[:_SHORT_TEXT],
            })

    if fw_ids:
        fws = db.query(FrameworkControl).filter(FrameworkControl.id.in_(fw_ids)).all()
        for fc in fws:
            text = (fc.statement or fc.control_objective or "").strip().replace("\n", " ")
            members.append({
                "ref": "framework", "ref_id": fc.id,
                "framework": "Framework",
                "code": getattr(fc, "control_id", "") or "",
                "name": (fc.name or "")[:200],
                "text": text[:_SHORT_TEXT],
            })
    return members


# ── AI clustering for one domain ─────────────────────────────────────────────

_SYSTEM = (
    "You are a senior GRC control-harmonization analyst building a unified control "
    "library. You read compliance controls drawn from MANY different regulatory "
    "frameworks and consolidate them into a small set of NORMALIZED controls. Each "
    "normalized control captures ONE distinct requirement that several frameworks "
    "express in different words, so that satisfying the normalized control with a "
    "single set of evidence satisfies every framework control mapped to it. You "
    "reason about the underlying INTENT of each control — not its wording — before "
    "deciding what is the same requirement and what is genuinely different."
)


def _cluster_prompt(domain: str, batch: List[dict]) -> str:
    lines = []
    for i, m in enumerate(batch):
        lines.append(f"[{i}] framework=\"{m['framework']}\" ref={m['code']} :: {m['name']} — {m['text']}")
    listing = "\n".join(lines)
    return (
        f"Domain: \"{domain}\"\n\n"
        f"You are given {len(batch)} controls. Each is tagged with the FRAMEWORK it "
        f"comes from. Reason about what each control actually requires, then consolidate "
        f"them into a SMALL set of normalized controls.\n\n"
        f"HARD RULES:\n"
        f"1. A normalized control may ONLY be created when the SAME underlying requirement "
        f"appears in TWO OR MORE DIFFERENT frameworks. Each normalized control MUST therefore "
        f"consolidate at least two controls coming from at least two DISTINCT frameworks — "
        f"even when their wording is very different. Finding that cross-framework overlap is "
        f"the entire purpose.\n"
        f"2. NEVER place two controls from the SAME framework into one normalized control. "
        f"Within a single framework every control is already distinct, so a normalized control "
        f"contains AT MOST ONE control per framework. It should read like: one control from "
        f"framework A + one from framework B (+ one from framework C) that all mean the same "
        f"thing.\n"
        f"3. DO NOT force coverage. A control whose requirement appears in ONLY ONE framework "
        f"(no genuine match in any other framework) is NOT normalization material — OMIT it "
        f"entirely. It is correct and expected to leave many inputs out. Never wrap a single "
        f"control, or several controls from the same one framework, into a normalized control.\n"
        f"4. Never force unrelated controls together just to consolidate — distinct "
        f"requirements stay separate. Return ZERO normalized controls if nothing genuinely "
        f"overlaps across frameworks.\n"
        f"5. SAME SPECIFIC OBLIGATION, not merely same topic. Two controls in the same area "
        f"are only one normalized control if they require THE SAME ACTION. Keep "
        f"topically-adjacent but distinct obligations in SEPARATE normalized controls. "
        f"Apply this universally to every control. As a few illustrations only (NOT an "
        f"exhaustive list — generalise the principle): 'network segmentation' vs 'traffic "
        f"filtering'; 'asset ownership' vs 'tracking asset movement'; 'unique user "
        f"identifier' vs 'unique passwords'; 'granting access rights' vs 'reviewing access "
        f"rights'. If you cannot state the members' obligation in ONE sentence without "
        f"using 'and', they are probably different requirements — split them.\n"
        f"6. NO broad catch-all controls. Do not create a vague umbrella and dump "
        f"loosely-related controls into it. NEVER name a normalized control after the "
        f"domain itself (the domain is \"{domain}\" — do not output a control called "
        f"that or a paraphrase of it). Each normalized control's name must describe ONE "
        f"precise obligation (e.g. 'Network Segmentation', 'Privileged Access Review', "
        f"'Phishing Simulation Training'). If members only share a broad theme, do not "
        f"merge them.\n"
        f"7. Treat distinct LIFECYCLE STAGES of the same subject as SEPARATE normalized "
        f"controls: provisioning/granting access, reviewing/recertifying access, and "
        f"revoking access are three different controls — never one. Same for "
        f"assessing vs treating vs monitoring risk.\n"
        f"8. POLICY vs OPERATION are DIFFERENT controls. A control that requires "
        f"WRITING / ESTABLISHING / MAINTAINING a policy or procedure for X must NEVER be "
        f"merged with a control that requires DOING the operational activity X. Group "
        f"\"develop X\" only with another \"develop X\"; group the operational \"do X\" "
        f"only with another operational \"do X\". This is a GENERAL rule for every "
        f"control — decide by the governing VERB (define/establish/maintain a policy "
        f"vs perform/operate the activity), not by topic keywords.\n\n"
        f"For each normalized control return:\n"
        f"  - name: a short, framework-neutral title (e.g. \"Privileged Access Management\")\n"
        f"  - statement: ONE clear sentence stating the consolidated requirement\n"
        f"  - objective: one sentence on the risk it addresses / why it matters\n"
        f"  - members: the list of input indices [n] it consolidates\n\n"
        f"Controls:\n{listing}\n\n"
        f"MANDATORY FIRST STEP — in the \"reasoning\" string, label EACH input [n] as "
        f"either P (the control's primary requirement is to ESTABLISH/DEFINE/MAINTAIN a "
        f"policy, procedure, standard, agreement or documented framework) or O (the "
        f"control's primary requirement is to PERFORM/OPERATE the activity). Then form "
        f"clusters ONLY among controls with the SAME label: never put a P control and an "
        f"O control in the same normalized control. THEN apply the same-specific-"
        f"obligation rules. Respond ONLY with JSON: {{\"reasoning\": \"[0]=O [1]=P ...\", "
        f"\"normalized_controls\": [{{\"name\": \"...\", \"statement\": \"...\", "
        f"\"objective\": \"...\", \"members\": [0,2,5]}}]}}"
    )


def _parse_member_idxs(raw_members) -> List[int]:
    idxs = []
    for x in raw_members or []:
        try:
            idxs.append(int(x))
        except (TypeError, ValueError):
            continue
    return idxs


def _enforce_one_per_framework(refs: List[dict]) -> List[dict]:
    """Safety net for rule #2: a normalized control must not hold two controls
    from the same framework. If the model ever violates it, keep the first
    control per framework here (the rest get re-considered by the caller)."""
    seen_fw = set()
    kept, overflow = [], []
    for r in refs:
        fw = r.get("framework") or "?"
        if fw in seen_fw:
            overflow.append(r)
        else:
            seen_fw.add(fw)
            kept.append(r)
    return kept, overflow


def _ai_cluster_batch(client, domain: str, batch: List[dict]) -> List[dict]:
    resp = client.chat.completions.create(
        model=get_openai_model(),
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": _cluster_prompt(domain, batch)},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    out: List[dict] = []
    leftovers: List[dict] = []
    for nc in data.get("normalized_controls", []) or []:
        refs = [batch[i] for i in _parse_member_idxs(nc.get("members")) if 0 <= i < len(batch)]
        if not refs and not (nc.get("name") or "").strip():
            continue
        kept, overflow = _enforce_one_per_framework(refs)
        leftovers.extend(overflow)
        out.append({
            "name": (nc.get("name") or "Untitled control").strip()[:255],
            "statement": (nc.get("statement") or "").strip(),
            "objective": (nc.get("objective") or "").strip(),
            "refs": kept,
        })
    # Overflow controls (a second control the model tried to put under a framework
    # slot already taken) are NOT normalization material — a control unique to a
    # single framework should never become its own normalized control. Drop them;
    # the ">= 2 frameworks" guard in run_normalization is the final safety net.
    return out


def _merge_prompt(domain: str, partials: List[dict]) -> str:
    lines = [f"[{i}] {p['name']}: {p['statement'] or p['name']}" for i, p in enumerate(partials)]
    listing = "\n".join(lines)
    return (
        f"Domain: \"{domain}\"\n\n"
        f"Below are {len(partials)} candidate normalized controls that were produced from "
        f"separate chunks of the SAME domain. Some of them are duplicates describing the "
        f"same requirement in different words. Decide which candidates are the same and "
        f"merge them.\n\n"
        f"For each FINAL normalized control return name, statement, objective, and members "
        f"= the list of candidate indices [n] that merge into it. Cover every candidate "
        f"exactly once; a candidate with no duplicate simply maps to itself.\n\n"
        f"Candidates:\n{listing}\n\n"
        f"Respond ONLY with JSON: {{\"normalized_controls\": [{{\"name\": \"...\", "
        f"\"statement\": \"...\", \"objective\": \"...\", \"members\": [0,3]}}]}}"
    )


def _ai_merge_partials(client, domain: str, partials: List[dict]) -> List[dict]:
    """Merge per-chunk cluster results using a SECOND model call (no string or
    regex matching). The model decides which candidate clusters are equivalent."""
    if len(partials) <= 1:
        return partials
    resp = client.chat.completions.create(
        model=get_openai_model(),
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": _merge_prompt(domain, partials)},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return partials
    out: List[dict] = []
    used = set()
    for g in data.get("normalized_controls", []) or []:
        idxs = [i for i in _parse_member_idxs(g.get("members")) if 0 <= i < len(partials)]
        if not idxs:
            continue
        refs: List[dict] = []
        for ix in idxs:
            used.add(ix)
            refs.extend(partials[ix]["refs"])
        # Rule #2 again, across the merged set.
        kept, _ = _enforce_one_per_framework(refs)
        out.append({
            "name": (g.get("name") or partials[idxs[0]]["name"]).strip()[:255],
            "statement": (g.get("statement") or partials[idxs[0]].get("statement") or "").strip(),
            "objective": (g.get("objective") or partials[idxs[0]].get("objective") or "").strip(),
            "refs": kept,
        })
    # Never drop a candidate the merge step forgot to mention.
    for ix, p in enumerate(partials):
        if ix not in used:
            out.append(p)
    return out


_VERIFY_SYSTEM = (
    "You are a GRC control-mapping reviewer. You are given one normalized "
    "requirement and the framework controls grouped under it. Keep every control "
    "that addresses the SAME core control objective — even if its wording, scope, "
    "or level of detail differs (e.g. 'Establish a vulnerability management "
    "process' and 'Vulnerability Management' belong together; a policy and its "
    "matching procedure on the same subject belong together). Only DROP a control "
    "when its actual subject is clearly DIFFERENT from the cluster's requirement "
    "(e.g. 'Unique User Identification' vs 'National-ID verification', or 'Access "
    "control to source code' vs general 'Access Control'). Also drop a control "
    "that is only TOPICALLY ADJACENT — same area but a different specific action "
    "(e.g. 'network segmentation' vs 'traffic filtering', 'asset ownership' vs "
    "'tracking asset movement', 'granting access' vs 'reviewing access'). Crucially, "
    "DROP a control that requires WRITING/ESTABLISHING a POLICY or PROCEDURE for X "
    "when the others require performing the OPERATIONAL activity X (policy != "
    "operation). When the core action genuinely matches but wording/scope differs, "
    "KEEP it; do not drop merely for being broader, narrower, or worded differently."
)


# How many clusters to verify in a SINGLE LLM call. Batching many clusters per
# request cuts verification cost ~N-fold versus one-call-per-cluster.
_VERIFY_BATCH = 6


def _verify_batch_prompt(batch: List[dict]) -> str:
    """One prompt covering several clusters; each cluster's members are indexed
    locally so the model returns keep-lists per cluster."""
    blocks = []
    for ci, d in enumerate(batch):
        refs = d.get("refs") or []
        lines = [
            f"    [{i}] framework=\"{r.get('framework','')}\" ref={r.get('code','')} :: "
            f"{r.get('name','')} — {r.get('text','')}"
            for i, r in enumerate(refs)
        ]
        blocks.append(
            f"CLUSTER {ci} — \"{d['name']}\"\n"
            f"  requirement: {d.get('statement') or d['name']}\n"
            f"  members:\n" + "\n".join(lines)
        )
    listing = "\n\n".join(blocks)
    return (
        f"Review the following {len(batch)} proposed normalized controls. For EACH "
        f"cluster, return the member indices [n] to KEEP — keep every control that "
        f"addresses the same core control objective (different wording/scope is "
        f"fine), and drop ONLY a control whose subject is clearly about something "
        f"different. When unsure, keep it.\n\n"
        f"{listing}\n\n"
        f"Respond ONLY with JSON keyed by cluster number: "
        f"{{\"results\": [{{\"cluster\": 0, \"keep\": [0,2]}}, {{\"cluster\": 1, \"keep\": [0,1,3]}}]}}"
    )


def _verify_clusters(client, domain: str, defs: List[dict]) -> List[dict]:
    """Second-pass adversarial check, BATCHED to save cost: several clusters per
    LLM call. For each cluster the model keeps only members that truly share the
    requirement; clusters that no longer span >=2 controls are dropped. This is
    what catches false matches (e.g. 'Removal of Access Rights' vs 'Written
    Agreements with Authorized Parties')."""
    candidates = [d for d in defs if len(d.get("refs") or []) >= 2]
    verified: List[dict] = []
    for start in range(0, len(candidates), _VERIFY_BATCH):
        batch = candidates[start:start + _VERIFY_BATCH]
        try:
            resp = client.chat.completions.create(
                model=get_openai_model(),
                messages=[
                    {"role": "system", "content": _VERIFY_SYSTEM},
                    {"role": "user", "content": _verify_batch_prompt(batch)},
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
            )
            data = json.loads(resp.choices[0].message.content or "{}")
            keep_by_cluster: Dict[int, List[int]] = {}
            for r in data.get("results", []) or []:
                try:
                    keep_by_cluster[int(r.get("cluster"))] = _parse_member_idxs(r.get("keep"))
                except (TypeError, ValueError):
                    continue
        except Exception:
            logger.exception("verification failed for a batch in %r — keeping as-is", domain)
            verified.extend(batch)
            continue
        for ci, d in enumerate(batch):
            refs = d.get("refs") or []
            keep_idx = [i for i in keep_by_cluster.get(ci, list(range(len(refs)))) if 0 <= i < len(refs)]
            kept = [refs[i] for i in keep_idx]
            if len(kept) >= 2:  # must still consolidate >=2 controls
                verified.append({**d, "refs": kept})
    return verified


def _normalize_one_domain(client, domain: str, members: List[dict]) -> List[dict]:
    """Cluster a domain's members into normalized-control definitions — entirely
    via the model. Small/medium domains go in one call; large domains are chunked
    and then merged by a second AI call (no name/regex merging anywhere). Every
    cluster is then re-checked by an adversarial verification pass that drops
    members (or whole clusters) that don't truly share the requirement."""
    if not members:
        return []
    if len(members) <= _SINGLE_CALL_MAX:
        clusters = _ai_cluster_batch(client, domain, members)
    else:
        partials: List[dict] = []
        for i in range(0, len(members), _CHUNK_SIZE):
            partials.extend(_ai_cluster_batch(client, domain, members[i:i + _CHUNK_SIZE]))
        clusters = _ai_merge_partials(client, domain, partials)
    return _verify_clusters(client, domain, clusters)


# ── Orchestration + persistence ──────────────────────────────────────────────

def _next_nc_seq(db: Session) -> int:
    """Highest NC-#### sequence currently in use, so new codes don't collide."""
    mx = 0
    for (code,) in db.query(NormalizedControl.code).all():
        m = re.match(r"^NC-(\d+)$", code or "")
        if m:
            mx = max(mx, int(m.group(1)))
    return mx


# ── AI canonical-tagging global candidate matching (no embeddings) ────────────
_TAG_BATCH = 80  # controls per tagging call (bigger = fewer calls = finishes faster)


_TAG_SYS = (
    "You are a GRC taxonomist. For each control you assign ONE canonical "
    "control-family label that captures its specific requirement (e.g. "
    "'Privileged Access Management', 'Change Management', 'Data Encryption', "
    "'Access Rights Review'). The family must be SPECIFIC, not a broad domain: "
    "use 'Access Rights Review' not 'Access Control'. Controls that impose the "
    "SAME requirement — even across different frameworks and different wording — "
    "MUST get the EXACT same family label, so reuse an existing label verbatim "
    "whenever one fits; only invent a new label when none fits."
)


def _tag_prompt(batch: List[dict], existing: List[str]) -> str:
    lines = [f"[{i}] framework=\"{m['framework']}\" {m['code']} :: {m['name']} — {m['text']}"
             for i, m in enumerate(batch)]
    vocab = ("\nEXISTING family labels (reuse verbatim when one fits):\n  "
             + "\n  ".join(sorted(existing)) if existing else "")
    return (
        f"Assign each control its canonical control-family label.{vocab}\n\n"
        f"Controls:\n" + "\n".join(lines) +
        '\n\nRespond ONLY JSON: {"tags":[{"i":0,"family":"..."}]}'
    )


def _build_taxonomy(client, members: List[dict],
                    should_cancel=None, progress_cb=None) -> List[str]:
    """PHASE 1 (memory): the AI scans every control and builds ONE canonical list
    of control families for the whole library. This fixed list is the shared
    memory that phase-2 classification references, so equivalent controls in
    different batches end up under the SAME family (no drift)."""
    families: Dict[str, str] = {}   # canonical(lower) -> display
    total = (len(members) + _TAG_BATCH - 1) // _TAG_BATCH
    for bi, start in enumerate(range(0, len(members), _TAG_BATCH)):
        if should_cancel and should_cancel():
            raise AutoGroupCancelled()
        if progress_cb:
            progress_cb(int(25 * bi / max(1, total)), 100,
                        f"Building control taxonomy ({bi + 1}/{total})…")
        batch = members[start:start + _TAG_BATCH]
        lines = [f"- ({m['framework']}) {m['name']}: {m['text'][:120]}" for m in batch]
        existing = ("\nFamilies so far (REUSE verbatim, only add genuinely new "
                    "ones):\n  " + "\n  ".join(sorted(families.values()))) if families else ""
        prompt = (
            "Extract the canonical control-family names these controls belong to. "
            "Each family is a SPECIFIC requirement (e.g. 'Privileged Access "
            "Management', 'Change Management', 'Data Encryption'), not a broad "
            "domain. Merge synonyms into one." + existing +
            "\n\nControls:\n" + "\n".join(lines) +
            '\n\nRespond ONLY JSON: {"families":["...","..."]}')
        try:
            resp = client.chat.completions.create(
                model=get_openai_model(),
                messages=[{"role": "system", "content": _TAG_SYS},
                          {"role": "user", "content": prompt}],
                response_format={"type": "json_object"}, temperature=0.0)
            data = json.loads(resp.choices[0].message.content or "{}")
        except Exception:
            logger.exception("taxonomy batch %d failed", bi)
            continue
        for fam in data.get("families", []) or []:
            fam = (fam or "").strip()
            if fam:
                families.setdefault(re.sub(r"[^a-z0-9]+", " ", fam.lower()).strip(), fam)
    return sorted(families.values())


def _classify_to_taxonomy(client, members: List[dict], taxonomy: List[str],
                          should_cancel=None, progress_cb=None) -> List[Optional[str]]:
    """PHASE 2: assign each control to ONE family from the FIXED taxonomy (handed
    to the model in full every call — that is the shared memory that prevents
    drift). Controls that fit nothing map to None and are left un-normalized."""
    tags: List[Optional[str]] = [None] * len(members)
    canon = {re.sub(r"[^a-z0-9]+", " ", t.lower()).strip(): t for t in taxonomy}
    tax_block = "\n".join(f"- {t}" for t in taxonomy)
    total = (len(members) + _TAG_BATCH - 1) // _TAG_BATCH
    for bi, start in enumerate(range(0, len(members), _TAG_BATCH)):
        if should_cancel and should_cancel():
            raise AutoGroupCancelled()
        if progress_cb:
            progress_cb(25 + int(20 * bi / max(1, total)), 100,
                        f"Classifying controls ({bi + 1}/{total})…")
        batch = members[start:start + _TAG_BATCH]
        lines = [f"[{i}] ({m['framework']}) {m['name']}: {m['text'][:120]}" for i, m in enumerate(batch)]
        prompt = (
            "Assign each control to EXACTLY ONE family from this fixed list (copy "
            "the family name verbatim). If a control truly fits none, use "
            "\"NONE\".\n\nFAMILIES:\n" + tax_block +
            "\n\nControls:\n" + "\n".join(lines) +
            '\n\nRespond ONLY JSON: {"tags":[{"i":0,"family":"..."}]}')
        try:
            resp = client.chat.completions.create(
                model=get_openai_model(),
                messages=[{"role": "system", "content": _TAG_SYS},
                          {"role": "user", "content": prompt}],
                response_format={"type": "json_object"}, temperature=0.0)
            data = json.loads(resp.choices[0].message.content or "{}")
        except Exception:
            logger.exception("classify batch %d failed", bi)
            continue
        for t in data.get("tags", []) or []:
            try:
                i = int(t.get("i"))
            except (TypeError, ValueError):
                continue
            fam = (t.get("family") or "").strip()
            if not fam or fam.upper() == "NONE" or not (0 <= i < len(batch)):
                continue
            key = re.sub(r"[^a-z0-9]+", " ", fam.lower()).strip()
            tags[start + i] = canon.get(key, fam)   # snap to taxonomy spelling
    return tags


def _ai_tag_controls(client, members: List[dict],
                     should_cancel=None, progress_cb=None) -> List[Optional[str]]:
    """Ask the AI to label every control with a canonical control-family. A
    growing shared vocabulary is fed into each batch so equivalent controls get
    the SAME label across the whole library. Returns a family per member."""
    tags: List[Optional[str]] = [None] * len(members)
    existing: Dict[str, str] = {}   # canonical(lower) -> display label
    total = (len(members) + _TAG_BATCH - 1) // _TAG_BATCH
    for bi, start in enumerate(range(0, len(members), _TAG_BATCH)):
        if should_cancel and should_cancel():
            raise AutoGroupCancelled()
        if progress_cb:
            progress_cb(int(45 * bi / max(1, total)), 100,
                        f"AI tagging controls ({bi + 1}/{total})…")
        batch = members[start:start + _TAG_BATCH]
        try:
            resp = client.chat.completions.create(
                model=get_openai_model(),
                messages=[{"role": "system", "content": _TAG_SYS},
                          {"role": "user", "content": _tag_prompt(batch, list(existing.values()))}],
                response_format={"type": "json_object"}, temperature=0.0)
            data = json.loads(resp.choices[0].message.content or "{}")
        except Exception:
            logger.exception("tagging batch %d failed — skipping", bi)
            continue
        for t in data.get("tags", []) or []:
            try:
                i = int(t.get("i"))
            except (TypeError, ValueError):
                continue
            fam = (t.get("family") or "").strip()
            if not fam or not (0 <= i < len(batch)):
                continue
            key = re.sub(r"[^a-z0-9]+", " ", fam.lower()).strip()
            fam = existing.setdefault(key, fam)   # reuse first spelling of a family
            tags[start + i] = fam
    return tags


def _consolidate_labels(client, tags: List[Optional[str]]) -> List[Optional[str]]:
    """Second AI pass that merges synonymous family labels (e.g. 'Privilege
    Management' + 'Privileged Access Management') into one canonical label. This
    repairs the label drift that happens across many tagging batches and is what
    lets fragmented equivalents regroup. Pure AI — no embeddings."""
    labels = sorted({t for t in tags if t})
    if len(labels) < 2:
        return tags
    mapping: Dict[str, str] = {}
    B = 150
    canon_vocab: List[str] = []
    for start in range(0, len(labels), B):
        chunk = labels[start:start + B]
        vocab = ("\nAlready-canonical labels (reuse verbatim if a chunk label means "
                 "the same):\n  " + "\n  ".join(canon_vocab)) if canon_vocab else ""
        prompt = (
            "Below is a list of control-family labels. Some are synonyms or the same "
            "requirement worded differently. Map EACH label to a single canonical "
            "label (pick the clearest name). Labels that are genuinely distinct map to "
            "themselves." + vocab + "\n\nLabels:\n  " + "\n  ".join(chunk) +
            '\n\nRespond ONLY JSON: {"map":[{"from":"...","to":"..."}]}')
        try:
            resp = client.chat.completions.create(
                model=get_openai_model(),
                messages=[{"role": "system", "content": "You consolidate a controls taxonomy."},
                          {"role": "user", "content": prompt}],
                response_format={"type": "json_object"}, temperature=0.0)
            data = json.loads(resp.choices[0].message.content or "{}")
        except Exception:
            logger.exception("label consolidation chunk failed")
            for l in chunk:
                mapping[l] = l
            continue
        for m in data.get("map", []) or []:
            frm = (m.get("from") or "").strip()
            to = (m.get("to") or "").strip() or frm
            if frm:
                mapping[frm] = to
                if to not in canon_vocab:
                    canon_vocab.append(to)
        for l in chunk:
            mapping.setdefault(l, l)
    return [mapping.get(t, t) if t else None for t in tags]


def _interleave_by_framework(members: List[dict]) -> List[dict]:
    """Round-robin members across their frameworks so all frameworks are seen
    early and evenly (steadies the shared family vocabulary)."""
    buckets: Dict[str, List[dict]] = {}
    for m in members:
        buckets.setdefault(m.get("framework") or "?", []).append(m)
    order = sorted(buckets, key=lambda k: -len(buckets[k]))
    out: List[dict] = []
    i = 0
    while any(i < len(buckets[k]) for k in order):
        for k in order:
            if i < len(buckets[k]):
                out.append(buckets[k][i])
        i += 1
    return out


def _candidate_clusters_by_tag(tags: List[Optional[str]],
                               frameworks: List[str]) -> List[List[int]]:
    """Group control indices by their AI family label; keep families spanning
    >= 2 distinct frameworks."""
    by_fam: Dict[str, List[int]] = {}
    for i, fam in enumerate(tags):
        if fam:
            key = re.sub(r"[^a-z0-9]+", " ", fam.lower()).strip()
            by_fam.setdefault(key, []).append(i)
    clusters = [idxs for idxs in by_fam.values()
                if len({frameworks[i] for i in idxs}) >= 2]
    clusters.sort(key=lambda c: -len({frameworks[i] for i in c}))
    return clusters


_REFINE_SYS = (
    "You are a senior GRC analyst turning candidate groups of similar controls "
    "into NORMALIZED controls. Each candidate group is already roughly similar "
    "across frameworks; your job is to confirm and tighten it."
)


def _refine_prompt(batch: List[List[dict]]) -> str:
    blocks = []
    for ci, cluster in enumerate(batch):
        lines = [f"    [{i}] framework=\"{m['framework']}\" ref={m['code']} :: {m['name']} — {m['text']}"
                 for i, m in enumerate(cluster)]
        blocks.append(f"GROUP {ci}:\n" + "\n".join(lines))
    return (
        f"Refine each of the {len(batch)} candidate groups below into normalized control(s).\n\n"
        f"RULES (apply per group):\n"
        f"1. A normalized control must consolidate controls from >=2 DIFFERENT frameworks, "
        f"AT MOST ONE control per framework.\n"
        f"2. If a group mixes DISTINCT requirements, SPLIT it into several normalized "
        f"controls (e.g. an incident group → 'Incident Response Plan', 'Incident Reporting', "
        f"'Incident Response Testing').\n"
        f"3. Same SPECIFIC obligation only — keep topically-adjacent but different actions "
        f"apart; lifecycle stages (grant vs review vs revoke; assess vs treat) are separate; "
        f"a control that WRITES a policy for X is NOT the same as one that OPERATES X.\n"
        f"4. Drop any control that does not belong with any other (no cross-framework match).\n\n"
        f"For each resulting normalized control return: name (framework-neutral), statement "
        f"(one sentence), objective (one sentence), group (the GROUP number), members (the "
        f"[n] indices WITHIN that group).\n\n"
        + "\n\n".join(blocks) +
        '\n\nRespond ONLY JSON: {"controls":[{"group":0,"name":"...","statement":"...",'
        '"objective":"...","members":[0,2]}]}'
    )


def _refine_candidate_batch(client, batch: List[List[dict]]) -> Dict[int, List[dict]]:
    """Refine several candidate clusters in ONE call. Returns {group_index: [defs]}
    where each def has name/statement/objective/refs."""
    resp = client.chat.completions.create(
        model=get_openai_model(),
        messages=[{"role": "system", "content": _REFINE_SYS},
                  {"role": "user", "content": _refine_prompt(batch)}],
        response_format={"type": "json_object"}, temperature=0.1,
    )
    out: Dict[int, List[dict]] = {}
    try:
        data = json.loads(resp.choices[0].message.content or "{}")
    except json.JSONDecodeError:
        return out
    for c in data.get("controls", []) or []:
        try:
            gi = int(c.get("group"))
        except (TypeError, ValueError):
            continue
        if not (0 <= gi < len(batch)):
            continue
        idxs = _parse_member_idxs(c.get("members"))
        refs = [batch[gi][i] for i in idxs if 0 <= i < len(batch[gi])]
        # Rule: a normalized control holds AT MOST ONE control per framework.
        refs, _overflow = _enforce_one_per_framework(refs)
        if len(refs) < 2:
            continue
        out.setdefault(gi, []).append({
            "name": (c.get("name") or "Untitled control").strip()[:255],
            "statement": (c.get("statement") or "").strip(),
            "objective": (c.get("objective") or "").strip(),
            "refs": refs,
        })
    return out


def run_normalization(
    db: Session,
    tenant_id: int,
    group_ids: Optional[List[int]],
    *,
    run_id: Optional[int] = None,
    framework_ids: Optional[List[int]] = None,
    progress_cb: Optional[Callable[[int, int, str], None]] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    """Generate normalized controls (pure-AI: tag → group → refine → verify).

    run_id scopes this as an isolated SESSION — only this run's prior controls
    are cleared/regenerated, never another session's. framework_ids restricts a
    custom run to the selected frameworks (None = full baseline over all).
    """
    client = get_openai_client()

    # 1) Fetch framework controls (tenant-owned + shared). A custom session limits
    #    to the chosen frameworks; a full run takes the whole corpus.
    pq = (db.query(ParsedFrameworkControl)
          .join(UploadedFramework, ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id)
          .filter(or_(UploadedFramework.tenant_id == tenant_id, UploadedFramework.tenant_id.is_(None))))
    if framework_ids:
        pq = pq.filter(ParsedFrameworkControl.uploaded_framework_id.in_(framework_ids))
    parsed = pq.all()
    if len(parsed) < 2:
        return {"normalized_controls_created": 0, "links_created": 0, "candidates": 0}

    fw_names = {f.id: f.name for f in db.query(UploadedFramework).all()}
    # control_id -> the domain group it belongs to (for UI placement), if grouped.
    grp_of: Dict[int, int] = {}
    for m in db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.parsed_control_id.isnot(None)).all():
        grp_of.setdefault(m.parsed_control_id, m.group_id)

    members: List[dict] = []
    for p in parsed:
        fw = fw_names.get(p.uploaded_framework_id, "Unknown")
        body = (p.description or p.full_text or "").strip().replace("\n", " ")
        members.append({
            "ref": "parsed", "ref_id": p.id, "framework": fw,
            "code": p.original_reference or p.control_id or "",
            "name": (p.title or "")[:200], "text": body[:_SHORT_TEXT],
        })

    # The AI labels every control with a canonical control-family (shared, growing
    # vocabulary so equivalents get the SAME label across the whole library), then
    # we group by family — no embeddings, every decision is the model's.
    # Interleave by framework so the family vocabulary forms evenly across all
    # frameworks early — equivalents from later frameworks then reuse the same
    # label instead of inventing new ones (this is what lifts recall).
    members = _interleave_by_framework(members)

    # The AI labels every control with a canonical control-family (shared growing
    # vocabulary so equivalents get the SAME label), then we group by family.
    # 100% AI — no embeddings, no vectors.
    tags = _ai_tag_controls(client, members, should_cancel=should_cancel, progress_cb=progress_cb)
    frameworks = [m["framework"] for m in members]
    candidates = _candidate_clusters_by_tag(tags, frameworks)
    if progress_cb:
        progress_cb(48, 100, f"Found {len(candidates)} cross-framework control families; refining…")

    # 2) Clear prior AI-normalized controls for THIS SESSION only (so re-running a
    #    session refreshes it without touching other sessions). When run_id is
    #    None (legacy single-set mode) clear all, preserving old behaviour.
    from sqlalchemy import text as _text
    _clr = db.query(NormalizedControl.id).filter(NormalizedControl.source == "ai_normalized")
    _clr = _clr.filter(NormalizedControl.run_id == run_id) if run_id is not None else _clr
    # SAFETY GUARD (added after a stale worker wiped the baseline): a normalization
    # run must NEVER delete controls that belong to the active baseline run — not
    # even in legacy run_id=None "clear all" mode. The baseline is rebuilt only by
    # the offline admin scripts, never by an interactive session/auto-group job.
    _baseline_ids = [r.id for r in db.query(NormalizationRun).filter(
        NormalizationRun.is_baseline.is_(True)).all()]
    if _baseline_ids:
        _clr = _clr.filter(or_(NormalizedControl.run_id.is_(None),
                               NormalizedControl.run_id.notin_(_baseline_ids)))
    old_ids = [nid for (nid,) in _clr.all()]
    if old_ids:
        db.query(NormalizedControlLink).filter(
            NormalizedControlLink.normalized_control_id.in_(old_ids)).delete(synchronize_session=False)
        db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.normalized_control_id.in_(old_ids)).delete(synchronize_session=False)
        for tbl in ("grc_ai_evidence_recommendations", "grc_evidence_control_mappings"):
            try:
                db.execute(_text(f"DELETE FROM {tbl} WHERE normalized_control_id = ANY(:ids)"), {"ids": old_ids})
            except Exception:
                logger.exception("global cleanup of %s failed", tbl)
        db.query(NormalizedControl).filter(
            NormalizedControl.id.in_(old_ids)).delete(synchronize_session=False)
        db.commit()

    seq = _next_nc_seq(db)
    created_nc = 0
    created_links = 0
    claimed: set = set()       # a control is consolidated into at most one NC
    n_cand = len(candidates)

    # 3) Refine candidate clusters with the AI — BATCHED (several small clusters
    #    per call, capped by total member count) so the whole library is refined
    #    in tens of calls, not hundreds. Each candidate is split/verified/named.
    _REFINE_MEMBER_CAP = 60
    batches: List[List[List[dict]]] = []
    cur_batch: List[List[dict]] = []
    cur_count = 0
    for idxs in candidates:
        cm = [members[i] for i in idxs]
        if cur_batch and cur_count + len(cm) > _REFINE_MEMBER_CAP:
            batches.append(cur_batch); cur_batch = []; cur_count = 0
        cur_batch.append(cm); cur_count += len(cm)
    if cur_batch:
        batches.append(cur_batch)

    def _persist_def(d: dict) -> None:
        nonlocal seq, created_nc, created_links
        refs = []
        for ref in d["refs"]:
            k = (ref["ref"], ref["ref_id"])
            if k in claimed:
                continue
            claimed.add(k)
            refs.append(ref)
        distinct_frameworks = {(r.get("framework") or "").strip().lower()
                               for r in refs if (r.get("framework") or "").strip()}
        if len(distinct_frameworks) < 2:
            return
        grp_votes: Dict[int, int] = {}
        for r in refs:
            g = grp_of.get(r["ref_id"])
            if g:
                grp_votes[g] = grp_votes.get(g, 0) + 1
        group_id = max(grp_votes, key=grp_votes.get) if grp_votes else None
        seq += 1
        nc = NormalizedControl(
            code=f"NC-{seq:04d}", name=d["name"],
            statement=d["statement"] or None, objective=d["objective"] or None,
            domain=(d["name"] or "Normalized")[:255], source="ai_normalized",
            common_group_id=group_id, maturity_level=0, run_id=run_id,
        )
        db.add(nc)
        db.flush()
        created_nc += 1
        for ref in refs:
            db.add(NormalizedControlLink(
                normalized_control_id=nc.id,
                parsed_control_id=ref["ref_id"] if ref["ref"] == "parsed" else None,
                framework_control_id=ref["ref_id"] if ref["ref"] == "framework" else None,
                mapping_type="direct"))
            created_links += 1
        if group_id:
            db.add(CommonControlGroupMapping(
                group_id=group_id, normalized_control_id=nc.id,
                mapping_source="ai_normalized"))

    # Refine AND persist INCREMENTALLY (commit each batch) so a mid-run stop keeps
    # everything produced so far — never wiping the library with nothing to show.
    for bi, batch in enumerate(batches):
        if should_cancel and should_cancel():
            break
        if progress_cb:
            progress_cb(50 + int(48 * bi / max(1, len(batches))), 100,
                        f"Refining control families ({bi + 1}/{len(batches)} batches)…")
        try:
            refined = _refine_candidate_batch(client, batch)
        except Exception:
            logger.exception("refine batch %d failed — skipping", bi)
            continue
        # Adversarial verification: a strict second AI pass drops members that
        # don't truly share the requirement (and whole clusters that fall below
        # 2 frameworks). This is what keeps accuracy high.
        batch_defs = [d for defs in refined.values() for d in defs]
        try:
            batch_defs = _verify_clusters(client, "verify", batch_defs)
        except Exception:
            logger.exception("verify batch %d failed — keeping unverified", bi)
        for d in batch_defs:
            _persist_def(d)
        db.commit()

    merged = _merge_same_name_ncs(db, tenant_id, run_id=run_id)

    # 4b) CONSERVATIVE fragment-merge: tagging drift can split the SAME requirement
    #     into two differently-named controls ("Audit Logging" vs "Audit Record
    #     Management"). Merge ONLY true duplicates — verified, never lumping
    #     different lifecycle stages or sub-activities.
    frag = _merge_fragments(db, client, run_id, progress_cb=progress_cb)

    # 5) Evidence normalization — part of the pipeline. For each unified control,
    #    AI-merge its frameworks' recommended evidence into one consolidated list
    #    (upload once → satisfies all). Resilient: per-NC, the controls are
    #    already saved, so a failure here never harms them.
    ev_done = _precompute_nc_evidence(db, client, run_id=run_id,
                                      progress_cb=progress_cb, should_cancel=should_cancel)
    domains_done = n_cand

    return {
        "domains_processed": domains_done,
        "normalized_controls_created": created_nc,
        "links_created": created_links,
        "duplicates_merged": merged,
        "fragments_merged": frag,
        "evidence_consolidated": ev_done,
    }


def _merge_fragments(db: Session, client, run_id: Optional[int], progress_cb=None) -> int:
    """Conservatively merge unified controls that are the SAME requirement split
    apart by inconsistent labels. TWO passes: (1) the AI proposes merge clusters
    with a strict 'same obligation only' rule; (2) each proposed cluster is
    re-verified strictly and only applied if confirmed — so different lifecycle
    stages / sub-activities are never lumped. Returns # of controls merged away."""
    q = db.query(NormalizedControl).filter(NormalizedControl.source == "ai_normalized")
    if run_id is not None:
        q = q.filter(NormalizedControl.run_id == run_id)
    ncs = q.order_by(NormalizedControl.name).all()
    if len(ncs) < 2:
        return 0

    items = []
    for nc in ncs:
        items.append({"id": nc.id, "name": nc.name, "stmt": (nc.statement or "")[:110]})

    PROPOSE_SYS = "You audit whether two compliance controls are the same requirement."

    # Deterministic candidate finding: bucket controls whose NAMES strongly overlap
    # (so "Physical Access Control" / "Physical Access Controls" / "Physical Access
    # Control Management" cluster, but "Incident Detection" / "Incident Response" do
    # NOT — they only share one word). The strict AI verify then confirms.
    _STOP = {"and", "of", "the", "a", "for", "to", "in", "on", "with"}
    def _toks(name):
        ts = [re.sub(r"s$", "", w) for w in re.findall(r"[a-z0-9]+", (name or "").lower())]
        return {t for t in ts if t and t not in _STOP}
    tok = [_toks(it["name"]) for it in items]

    # Candidate PAIRS by name overlap (no transitive chaining — that bridges
    # distinct controls like 'Physical Access' & 'Privileged Access').
    n = len(items)
    cand_pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            a, b = tok[i], tok[j]
            if a and b and len(a & b) / len(a | b) >= 0.5:
                cand_pairs.append((i, j))

    # Strictly verify each candidate pair (batched) — same requirement, yes/no.
    def _verify_pairs(pairs):
        same = {}
        B = 12
        for s in range(0, len(pairs), B):
            chunk = pairs[s:s + B]
            lines = [f"[{k}] A=\"{items[i]['name']}\" ({items[i]['stmt']})  vs  "
                     f"B=\"{items[j]['name']}\" ({items[j]['stmt']})"
                     for k, (i, j) in enumerate(chunk)]
            prompt = ("For each pair, are A and B the EXACT SAME control requirement "
                      "(one could fully replace the other)? Answer false if they are "
                      "different lifecycle stages, sub-activities, scopes, or policy-vs-"
                      "operation.\n\n" + "\n".join(lines) +
                      '\n\nJSON: {"results":[{"pair":0,"same":true}]}')
            try:
                r = client.chat.completions.create(
                    model=get_openai_model(),
                    messages=[{"role": "system", "content": PROPOSE_SYS},
                              {"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}, temperature=0.0)
                for res in json.loads(r.choices[0].message.content or "{}").get("results", []) or []:
                    try:
                        same[s + int(res.get("pair"))] = bool(res.get("same"))
                    except (TypeError, ValueError):
                        continue
            except Exception:
                logger.exception("pair verify failed")
        return same

    if progress_cb:
        progress_cb(97, 100, f"Checking {len(cand_pairs)} possible duplicate controls…")
    verdicts = _verify_pairs(cand_pairs)

    # Union ONLY verified-same pairs → clusters of true duplicates.
    parent = list(range(n))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for k, (i, j) in enumerate(cand_pairs):
        if verdicts.get(k):
            parent[find(i)] = find(j)
    clusters = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(i)

    merged_away = 0
    for idxs in clusters.values():
        if len(idxs) < 2:
            continue
        idxs = sorted(idxs)
        primary = items[idxs[0]]["id"]
        seen_fw = set()
        for l in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id == primary).all():
            p = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id == l.parsed_control_id).first()
            if p:
                seen_fw.add(p.uploaded_framework_id)
        for j in idxs[1:]:
            dup = items[j]["id"]
            for l in db.query(NormalizedControlLink).filter(NormalizedControlLink.normalized_control_id == dup).all():
                p = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id == l.parsed_control_id).first()
                if p and p.uploaded_framework_id not in seen_fw:
                    seen_fw.add(p.uploaded_framework_id)
                    l.normalized_control_id = primary
                else:
                    db.delete(l)
            db.query(CommonControlGroupMapping).filter(
                CommonControlGroupMapping.normalized_control_id == dup).delete(synchronize_session=False)
            db.query(NormalizedControl).filter(NormalizedControl.id == dup).delete(synchronize_session=False)
            merged_away += 1
        db.commit()
    return merged_away


def _precompute_nc_evidence(db: Session, client, *, run_id=None, progress_cb=None,
                            should_cancel=None) -> int:
    """Pre-compute and store the AI-consolidated recommended evidence for every
    AI-normalized control in this session, so the drawer shows it instantly."""
    from ..routers.groups import _ai_consolidate_evidence, _normalize_evidence_reqs
    _q = db.query(NormalizedControl).filter(
        NormalizedControl.source == "ai_normalized",
        NormalizedControl.recommended_evidence.is_(None),
    )
    if run_id is not None:
        _q = _q.filter(NormalizedControl.run_id == run_id)
    ncs = _q.all()
    fw_names = {f.id: f.name for f in db.query(UploadedFramework).all()}
    done = 0
    for i, nc in enumerate(ncs):
        if should_cancel and should_cancel():
            break
        if progress_cb and (i % 10 == 0 or i == len(ncs) - 1):
            progress_cb(98, 100, f"Consolidating evidence ({i + 1}/{len(ncs)})…")
        items: List[dict] = []
        for ln in db.query(NormalizedControlLink).filter(
                NormalizedControlLink.normalized_control_id == nc.id).all():
            if not ln.parsed_control_id:
                continue
            p = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id == ln.parsed_control_id).first()
            if not p:
                continue
            fw = fw_names.get(p.uploaded_framework_id, "")
            code = p.original_reference or p.control_id or ""
            for e in _normalize_evidence_reqs(p.evidence_requirements):
                items.append({"name": e.get("name", ""), "description": e.get("description", ""),
                              "framework": fw, "code": code})
        if not items:
            continue
        try:
            consolidated = _ai_consolidate_evidence(items)
            if consolidated is not None:
                nc.recommended_evidence = consolidated
                db.commit()
                done += 1
        except Exception:
            db.rollback()
            logger.exception("evidence pre-compute failed for %s", nc.code)
    return done


def _merge_same_name_ncs(db: Session, tenant_id: int, run_id: Optional[int] = None) -> int:
    """Consolidate same-named AI-normalized controls WITHIN one session into a
    single control (links/memberships moved + de-duplicated, duplicates deleted).
    Returns how many duplicate NCs were removed."""
    from sqlalchemy import text as _text
    def _canon(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
    _q = db.query(NormalizedControl).filter(NormalizedControl.source == "ai_normalized")
    if run_id is not None:
        _q = _q.filter(NormalizedControl.run_id == run_id)
    ncs = _q.order_by(NormalizedControl.id).all()
    by_name: Dict[str, List[NormalizedControl]] = {}
    for nc in ncs:
        by_name.setdefault(_canon(nc.name), []).append(nc)

    removed = 0
    for name, group in by_name.items():
        if not name or len(group) < 2:
            continue
        primary = group[0]
        existing = {
            (l.parsed_control_id, l.framework_control_id)
            for l in db.query(NormalizedControlLink).filter(
                NormalizedControlLink.normalized_control_id == primary.id).all()
        }
        for dup in group[1:]:
            for l in db.query(NormalizedControlLink).filter(
                NormalizedControlLink.normalized_control_id == dup.id).all():
                key = (l.parsed_control_id, l.framework_control_id)
                if key in existing:
                    db.delete(l)
                else:
                    existing.add(key)
                    l.normalized_control_id = primary.id
            # Drop the duplicate's own dependents, then the duplicate itself.
            db.query(CommonControlGroupMapping).filter(
                CommonControlGroupMapping.normalized_control_id == dup.id
            ).delete(synchronize_session=False)
            for tbl in ("grc_ai_evidence_recommendations", "grc_evidence_control_mappings"):
                try:
                    db.execute(_text(f"DELETE FROM {tbl} WHERE normalized_control_id = :id"),
                               {"id": dup.id})
                except Exception:
                    logger.exception("merge cleanup of %s failed for nc %s", tbl, dup.id)
            db.delete(dup)
            removed += 1
        db.flush()
    db.commit()

    # Merging two same-named controls can put two controls from the SAME framework
    # under one control — re-enforce "at most one control per framework" by
    # dropping the extra links (keep the earliest per framework).
    db.execute(_text("""
        DELETE FROM grc_normalized_control_links WHERE id IN (
          SELECT link_id FROM (
            SELECT l.id AS link_id,
                   row_number() OVER (PARTITION BY l.normalized_control_id,
                                       p.uploaded_framework_id ORDER BY l.id) rn
            FROM grc_normalized_control_links l
            JOIN grc_parsed_framework_controls p ON p.id = l.parsed_control_id
          ) d WHERE rn > 1)
    """))
    db.commit()
    return removed
