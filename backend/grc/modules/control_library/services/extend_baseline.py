"""Extend the locked unified-library baseline with a NEW framework — incrementally.

When a developer adds a new framework (uploads its seed and ingests it), we do NOT
re-cluster the whole library. We:
  1. Load the current baseline (run N): its domains + normalized-set names.
  2. Classify ONLY the new framework's controls onto that fixed master list
     (the single AI step — reuses normalization._classify_to_taxonomy).
  3. analyze()  -> a dry-run report: which controls JOIN an existing set vs become
     STANDALONE, grouped by domain. Writes nothing.
  4. commit()   -> CLONE the baseline run into a new candidate run (N+1), preserving
     every set/member/evidence exactly, then ADD the new framework's controls
     (join matched sets, else standalone). Promote() makes it the live baseline,
     after which the whole UI reflects the new framework via get_baseline_run().

The baseline is never mutated in place — commit always produces a new run, so a bad
classification can be discarded instead of corrupting the live library.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import (
    NormalizationRun, NormalizedControl, NormalizedControlLink,
    CommonControlGroup, CommonControlGroupMapping, ParsedFrameworkControl,
    UploadedFramework,
)
from . import normalization as N
from .scoped_session import get_baseline_run

logger = logging.getLogger(__name__)


# ── helpers ──────────────────────────────────────────────────────────────────

def _baseline_view(db: Session, base: NormalizationRun) -> Dict[str, Any]:
    """Read the baseline run into plain structures we can clone/extend."""
    groups = db.query(CommonControlGroup).filter(CommonControlGroup.run_id == base.id).all()
    gid_domain = {g.id: (g.domain or g.name or "Other / Uncategorized") for g in groups}
    ncs = db.query(NormalizedControl).filter(NormalizedControl.run_id == base.id).all()
    # set-name -> domain (master list the new framework is classified onto)
    set_domain: Dict[str, str] = {}
    for nc in ncs:
        set_domain.setdefault(nc.name, nc.domain or "Other / Uncategorized")
    domains = sorted({(g.domain or g.name) for g in groups if (g.domain or g.name)})
    return {"groups": groups, "gid_domain": gid_domain, "ncs": ncs,
            "set_names": [nc.name for nc in ncs], "set_domain": set_domain,
            "domains": domains}


# Generic words that appear in many canonical domain names — ignored when
# name-matching a framework's domain so distinctive words drive the match.
_DOMAIN_STOPWORDS = {
    "security", "management", "control", "controls", "information", "system",
    "systems", "cyber", "cybersecurity", "program", "service", "services",
    "policy", "policies", "compliance", "assurance", "protection", "and", "the",
    "for", "with",
}


def _reconcile_domain(raw: Optional[str], domains: List[str]) -> Optional[str]:
    """Map a framework's OWN domain name onto one of our existing canonical domains
    (the 20), deterministically — exact match, then strong substring overlap.
    Returns None when no confident name match (caller falls back to AI classify)."""
    if not raw:
        return None
    r = raw.strip().lower()
    by_lower = {d.lower(): d for d in domains}
    if r in by_lower:
        return by_lower[r]
    # token-overlap on DISTINCTIVE words only. Generic words ("security",
    # "management", …) recur across many canonical domains and cause false ties
    # (e.g. "Datacenter Security" wrongly matching "Application & Software Security"),
    # so they are excluded — a match must be on a meaningful, domain-specific word.
    def toks(s):
        return {w for w in re.split(r"[^a-z0-9]+", s.lower())
                if len(w) > 3 and w not in _DOMAIN_STOPWORDS}
    rt = toks(raw)
    best, best_score = None, 0.0
    for d in domains:
        dt = toks(d)
        if not dt:
            continue
        inter = len(rt & dt)
        score = inter / max(1, min(len(rt), len(dt)))
        if inter >= 1 and score > best_score:
            best, best_score = d, score
    return best if best_score >= 0.5 else None


def classify_domains(
    db: Session, ufw_id: int, base: NormalizationRun, *,
    get_client: Callable[[], Any],
    progress_cb: Optional[Callable] = None, should_cancel: Optional[Callable] = None,
) -> Dict[int, str]:
    """STEP 3 — assign every new control to one of the EXISTING 20 domains by its own
    CONTENT (title + full description), via the AI classifier.

    Framework-AGNOSTIC by design: it does NOT look at the framework's own domain label
    and uses NO keyword/stopword rules, so it behaves identically for a cloud, safety,
    medical, automotive or energy framework it has never seen. Each control is judged on
    what it actually requires — this is what stops the pipeline from being tuned to one
    framework and failing on the next. Never invents a new domain; every control always
    receives one of the existing 20 (fallback guarantees no orphan)."""
    view = _baseline_view(db, base)
    domains = view["domains"]
    fallback = "Operations & IT Service Management" if "Operations & IT Service Management" in domains else (domains[-1] if domains else "Other / Uncategorized")
    rows = _new_framework_controls(db, ufw_id)
    if not rows or not domains:
        return {p.id: (p.domain or fallback) for p in rows}

    fw_name = {f.id: f.name for f in db.query(UploadedFramework).all()}
    members = [{"ref_id": p.id, "framework": fw_name.get(p.uploaded_framework_id, "?"),
                "fwid": p.uploaded_framework_id, "name": (p.title or ""),
                "text": _full_text(p)} for p in rows]
    members = N._interleave_by_framework(members)
    client = get_client()
    tags = N._classify_to_taxonomy(client, members, domains,
                                   should_cancel=should_cancel, progress_cb=progress_cb)
    valid = set(domains)
    out: Dict[int, str] = {p.id: fallback for p in rows}   # safe default → no orphan
    for m, t in zip(members, tags):
        if t in valid:
            out[m["ref_id"]] = t
    return out


def _new_framework_controls(db: Session, ufw_id: int) -> List[ParsedFrameworkControl]:
    return db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == ufw_id).all()


def _full_text(p: ParsedFrameworkControl) -> str:
    """The control's FULL text for classification — no truncation, no chunking.
    A framework is absorbed once, so we send each control's complete description +
    full_text (deduped) to the AI verbatim."""
    parts, seen = [], set()
    for t in (p.description, p.full_text):
        t = (t or "").strip()
        if t and t.lower() not in seen:
            parts.append(t); seen.add(t.lower())
    return "  ".join(parts)


def classify_onto_baseline(
    db: Session, ufw_id: int, base: NormalizationRun, *,
    get_client: Callable[[], Any],
    dom_map: Optional[Dict[int, str]] = None,
    progress_cb: Optional[Callable] = None,
    should_cancel: Optional[Callable] = None,
) -> Dict[int, Optional[str]]:
    """parsed_control_id -> matched baseline set-name (join) or None (no match → standalone).

    When `dom_map` (control -> reconciled domain) is supplied, matching is DOMAIN-SCOPED:
    each control is matched only against the set-names in its own domain (dozens of
    options) instead of all ~426 at once. This fixes the low-recall failure where
    ambiguous controls were sunk into one generic 'policy' set."""
    view = _baseline_view(db, base)
    rows = _new_framework_controls(db, ufw_id)
    if not rows:
        return {}
    fw_name = {f.id: f.name for f in db.query(UploadedFramework).all()}
    client = get_client()

    def _member(p):
        return {"ref_id": p.id, "framework": fw_name.get(p.uploaded_framework_id, "?"),
                "fwid": p.uploaded_framework_id, "name": (p.title or ""), "text": _full_text(p)}

    def _tag(members, master):
        if not members or not master:
            return {m["ref_id"]: None for m in members}
        members = N._interleave_by_framework(list(members))
        tags = N._classify_to_taxonomy(client, members, master,
                                       should_cancel=should_cancel, progress_cb=progress_cb)
        valid = set(master)
        return {m["ref_id"]: (t if t in valid else None) for m, t in zip(members, tags)}

    mapping: Dict[int, Optional[str]] = {}

    if dom_map:
        # group the baseline's set-names by domain, and the new controls by reconciled domain
        from collections import defaultdict
        sets_by_domain: Dict[str, List[str]] = defaultdict(list)
        for name, dom in view["set_domain"].items():
            sets_by_domain[dom].append(name)
        rows_by_domain: Dict[str, list] = defaultdict(list)
        for p in rows:
            rows_by_domain[dom_map.get(p.id) or "Other / Uncategorized"].append(p)
        for dom, prows in rows_by_domain.items():
            master = sets_by_domain.get(dom, [])
            mapping.update(_tag([_member(p) for p in prows], master))
        return mapping

    # fallback: global matching against all set-names
    return _tag([_member(p) for p in rows], view["set_names"])


# ── adversarial verification of proposed joins (precision guard) ─────────────

def _verify_join_prompt(items: List[dict]) -> str:
    lines = []
    for it in items:
        ex = "; ".join(it["set_examples"][:5]) or "(no example members)"
        lines.append(
            f'[{it["i"]}] NEW CONTROL: "{it["control"]}"\n'
            f'    detail: {it["control_detail"]}\n'
            f'    PROPOSED EXISTING SET: "{it["candidate_set"]}"\n'
            f'    that set already contains, e.g.: {ex}')
    body = "\n".join(lines)
    return (
        "You are auditing a cross-framework control-library normalization. For EACH item decide "
        "whether the NEW CONTROL and the PROPOSED EXISTING SET describe the SAME underlying "
        "control ACTIVITY (the same thing an organization must DO), so they should merge into one "
        "normalized control.\n\n"
        "CRITICAL — judge by the underlying activity, NOT by the subject-matter domain or wording. "
        "The library is intentionally cross-domain: a control worded for one domain (e.g. "
        "'information security') and another worded for a different domain (e.g. 'occupational "
        "health & safety', 'quality', 'privacy') are the SAME control when the required activity "
        "is the same. Management-system requirements recur across ISO standards and SHOULD match "
        "even when the domain wording differs — e.g. establishing the management system; "
        "top-management commitment/leadership; establishing an approved policy; defining and "
        "allocating roles & responsibilities; competence; awareness; controlling documented "
        "information; monitoring & measurement; internal audit; management review; nonconformity "
        "& corrective action; continual improvement.\n\n"
        "Answer same_control=FALSE only when the actual ACTIVITY genuinely differs — e.g. "
        "'consult and involve workers' is NOT 'define roles and communication lines'; "
        "'identify workplace hazards' is NOT a generic asset risk assessment unless truly "
        "equivalent. When the activity matches, answer TRUE regardless of domain wording.\n\n"
        f"{body}\n\n"
        'Return JSON: {"results":[{"i":<index>,"same_control":true|false,"reason":"<=8 words"}]}')


def _verify_joins(db: Session, base: NormalizationRun, mapping: Dict[int, Optional[str]],
                  rows: List[ParsedFrameworkControl], *, get_client: Callable[[], Any],
                  progress_cb: Optional[Callable] = None) -> Dict[str, Any]:
    """Second-pass check on every PROPOSED join. A weak/tangential match is demoted
    to standalone (its own new set). Mutates `mapping` in place. This is where the
    pipeline stops 'losing' — no control is force-fitted into a set it doesn't match."""
    from ....config import get_openai_model
    proposed = [(pid, sn) for pid, sn in mapping.items() if sn]
    if not proposed:
        return {"checked": 0, "kept": 0, "demoted": 0, "demoted_items": []}
    pc = {p.id: p for p in rows}
    view = _baseline_view(db, base)
    name_to_nc: Dict[str, Any] = {}
    for nc in view["ncs"]:
        name_to_nc.setdefault(nc.name, nc)
    setnames = {sn for _, sn in proposed}
    ncid_to_name = {name_to_nc[sn].id: sn for sn in setnames if sn in name_to_nc}
    # sample up to 5 existing member titles per proposed set (what the set REALLY is)
    members: Dict[str, List[str]] = {}
    if ncid_to_name:
        q = (db.query(NormalizedControlLink.normalized_control_id, ParsedFrameworkControl.title)
             .join(ParsedFrameworkControl, ParsedFrameworkControl.id == NormalizedControlLink.parsed_control_id)
             .filter(NormalizedControlLink.normalized_control_id.in_(list(ncid_to_name))))
        for ncid, title in q.all():
            sn = ncid_to_name.get(ncid)
            if sn and title:
                members.setdefault(sn, [])
                if len(members[sn]) < 5:
                    members[sn].append(title)

    client = get_client()
    model = get_openai_model()
    kept = 0
    demoted = 0
    demoted_items: List[dict] = []
    BATCH = 8
    total = (len(proposed) + BATCH - 1) // BATCH
    for bi, start in enumerate(range(0, len(proposed), BATCH)):
        batch = proposed[start:start + BATCH]
        items = []
        for i, (pid, sn) in enumerate(batch):
            p = pc.get(pid)
            items.append({"i": i, "control": (p.title or ""),
                          "control_detail": _full_text(p)[:900],
                          "candidate_set": sn, "set_examples": members.get(sn, [])})
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": "You are a meticulous GRC control-normalization auditor."},
                          {"role": "user", "content": _verify_join_prompt(items)}],
                response_format={"type": "json_object"}, temperature=0.0)
            data = json.loads(resp.choices[0].message.content or "{}")
            verdict = {}
            for r in data.get("results", []):
                if "i" in r:
                    verdict[int(r["i"])] = (bool(r.get("same_control")), (r.get("reason") or "")[:60])
        except Exception:
            logger.exception("join-verification batch failed — keeping this batch's joins as-is")
            verdict = {i: (True, "verify-error") for i in range(len(batch))}
        for i, (pid, sn) in enumerate(batch):
            ok, reason = verdict.get(i, (True, ""))
            if ok:
                kept += 1
            else:
                mapping[pid] = None  # demote → becomes a NEW standalone set
                demoted += 1
                p = pc.get(pid)
                demoted_items.append({"control_id": p.control_id, "title": (p.title or "")[:70],
                                      "was_set": sn, "reason": reason})
        if progress_cb:
            progress_cb(bi + 1, total, f"verified joins {min(start + BATCH, len(proposed))}/{len(proposed)}")
    return {"checked": len(proposed), "kept": kept, "demoted": demoted, "demoted_items": demoted_items}


# ── dry-run analysis ─────────────────────────────────────────────────────────

def analyze(db: Session, tenant_id: int, ufw_id: int, *, get_client: Callable[[], Any],
            progress_cb: Optional[Callable] = None) -> Dict[str, Any]:
    """Report how the new framework WOULD extend the baseline. Writes nothing."""
    base = get_baseline_run(db, tenant_id)
    if not base:
        raise RuntimeError("No baseline run exists — build the baseline first.")
    ufw = db.query(UploadedFramework).filter(UploadedFramework.id == ufw_id).first()
    if not ufw:
        raise RuntimeError(f"UploadedFramework {ufw_id} not found.")
    view = _baseline_view(db, base)
    # STEP 3 first — reconcile every control onto an existing canonical domain, then
    # match domain-scoped (only against sets in that domain) for high recall.
    dom_map = classify_domains(db, ufw_id, base, get_client=get_client, progress_cb=progress_cb)
    mapping = classify_onto_baseline(db, ufw_id, base, get_client=get_client, dom_map=dom_map, progress_cb=progress_cb)
    rows = _new_framework_controls(db, ufw_id)
    pc = {p.id: p for p in rows}

    joins: List[dict] = []
    standalones: List[dict] = []
    per_domain: Dict[str, Dict[str, int]] = {}
    new_domains: List[str] = []   # should stay EMPTY — we never create new domains
    canonical = set(view["domains"])
    for pid, set_name in mapping.items():
        p = pc.get(pid)
        if not p:
            continue
        if set_name:
            dom = view["set_domain"].get(set_name) or dom_map.get(pid) or "Operations & IT Service Management"
            joins.append({"control_id": p.control_id, "title": (p.title or "")[:80],
                          "joins_set": set_name, "domain": dom})
            d = per_domain.setdefault(dom, {"join": 0, "standalone": 0}); d["join"] += 1
        else:
            dom = dom_map.get(pid) or "Operations & IT Service Management"
            if dom not in canonical:
                new_domains.append(dom)
            standalones.append({"control_id": p.control_id, "title": (p.title or "")[:80],
                                "domain": dom, "framework_domain": p.domain})
            d = per_domain.setdefault(dom, {"join": 0, "standalone": 0}); d["standalone"] += 1

    return {
        "baseline_run_id": base.id,
        "framework": ufw.name,
        "framework_id": ufw_id,
        "new_controls": len(rows),
        "would_join_existing_set": len(joins),
        "would_be_standalone": len(rows) - len(joins),
        "domains_used": sorted(per_domain.keys()),
        "new_domains_created": sorted(set(new_domains)),   # expect [] — merged onto existing 20
        "per_domain": per_domain,
        "joins_sample": joins[:40],
        "standalone_sample": standalones[:40],
        "dry_run": True,
    }


# ── commit: clone baseline → new candidate run + add the framework ───────────

def commit(db: Session, tenant_id: int, ufw_id: int, *, get_client: Callable[[], Any],
           user_id: Optional[int] = None, label: Optional[str] = None,
           promote: bool = False, progress_cb: Optional[Callable] = None,
           mapping: Optional[Dict[int, Optional[str]]] = None,
           dom_map: Optional[Dict[int, str]] = None) -> Dict[str, Any]:
    """Create a new candidate baseline run = exact clone of the baseline + the new
    framework's controls classified onto it. Optionally promote it to live.

    `mapping` (set-join) and `dom_map` (Step-3 domain) may be passed in precomputed
    so the absorption job doesn't re-run the AI classifier it already ran."""
    base = get_baseline_run(db, tenant_id)
    if not base:
        raise RuntimeError("No baseline run exists — build the baseline first.")
    ufw = db.query(UploadedFramework).filter(UploadedFramework.id == ufw_id).first()
    if not ufw:
        raise RuntimeError(f"UploadedFramework {ufw_id} not found.")

    # STEP 3 — reconcile each control onto one of the existing canonical domains first,
    # so set-matching can be domain-scoped.
    if dom_map is None:
        dom_map = classify_domains(db, ufw_id, base, get_client=get_client, progress_cb=progress_cb)
    if mapping is None:
        mapping = classify_onto_baseline(db, ufw_id, base, get_client=get_client, dom_map=dom_map, progress_cb=progress_cb)

    if progress_cb:
        progress_cb(60, 100, "Cloning baseline into a new candidate run…")

    base_fw_ids = list(base.framework_ids or [])
    new_fw_ids = base_fw_ids + ([ufw_id] if ufw_id not in base_fw_ids else [])
    run = NormalizationRun(
        tenant_id=tenant_id,
        label=label or f"Baseline + {ufw.name}",
        scope="full", framework_ids=new_fw_ids, is_baseline=False,
        status="running", created_by=user_id, started_at=func.now(),
    )
    db.add(run); db.flush()

    # 1) clone groups (the 20 domains) — fresh codes (code is UNIQUE); domain->new gid
    old_groups = db.query(CommonControlGroup).filter(CommonControlGroup.run_id == base.id).all()
    domain_group: Dict[str, int] = {}
    for i, g in enumerate(old_groups):
        ng = CommonControlGroup(tenant_id=tenant_id, run_id=run.id, code=f"EXT{run.id}-D{i:02d}",
                                name=g.name, description=getattr(g, "description", None),
                                domain=g.domain, category=g.category,
                                keywords=getattr(g, "keywords", None) or [], created_by=user_id)
        db.add(ng); db.flush()
        domain_group[g.domain or g.name or "Other / Uncategorized"] = ng.id

    def group_for(domain: str) -> int:
        domain = domain or "Other / Uncategorized"
        if domain not in domain_group:
            g = CommonControlGroup(tenant_id=tenant_id, run_id=run.id,
                                   code=f"EXT{run.id}-D{len(domain_group):02d}",
                                   name=domain, domain=domain, category="control-type",
                                   keywords=[], created_by=user_id)
            db.add(g); db.flush(); domain_group[domain] = g.id
        return domain_group[domain]

    # 2) clone normalized controls (+ all content + evidence) with fresh UNIQUE codes
    old_ncs = db.query(NormalizedControl).filter(NormalizedControl.run_id == base.id).all()
    setname_ncid: Dict[str, int] = {}     # baseline set-name -> NEW nc id (for joining)
    setname_group: Dict[str, int] = {}
    cloned_sets = 0
    for seq_nc, nc in enumerate(old_ncs, start=1):
        gid = group_for(nc.domain or "Other / Uncategorized")
        nnc = NormalizedControl(
            code=f"EXT{run.id}-{seq_nc:05d}", name=nc.name, statement=getattr(nc, "statement", None),
            objective=getattr(nc, "objective", None), control_owner=getattr(nc, "control_owner", None),
            implementation_guidance=getattr(nc, "implementation_guidance", None),
            testing_guidance=getattr(nc, "testing_guidance", None),
            maturity_level=nc.maturity_level, domain=nc.domain, source=nc.source,
            common_group_id=gid, recommended_evidence=nc.recommended_evidence,
            review_status=getattr(nc, "review_status", None), run_id=run.id,
        )
        db.add(nnc); db.flush()
        setname_ncid[nc.name] = nnc.id
        setname_group[nc.name] = gid
        db.add(CommonControlGroupMapping(group_id=gid, normalized_control_id=nnc.id,
                                         mapping_source="domain", mapping_confidence=1.0))
        for ln in db.query(NormalizedControlLink).filter(
                NormalizedControlLink.normalized_control_id == nc.id).all():
            db.add(NormalizedControlLink(normalized_control_id=nnc.id,
                                         parsed_control_id=ln.parsed_control_id,
                                         mapping_type=ln.mapping_type))
            db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=ln.parsed_control_id,
                                             mapping_source="domain", mapping_confidence=1.0))
        cloned_sets += 1

    # 3) clone baseline STANDALONE parsed controls (group->parsed with no nc) so the
    #    cloned run is a faithful copy, not just the sets.
    cloned_standalone = 0
    seen_parsed = set()
    for m in db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id.in_([g.id for g in old_groups]),
            CommonControlGroupMapping.parsed_control_id.isnot(None),
            CommonControlGroupMapping.mapping_source == "standalone").all():
        old_g = next((g for g in old_groups if g.id == m.group_id), None)
        dom = (old_g.domain or old_g.name) if old_g else "Other / Uncategorized"
        db.add(CommonControlGroupMapping(group_id=group_for(dom), parsed_control_id=m.parsed_control_id,
                                         mapping_source="standalone", mapping_confidence=1.0))
        seen_parsed.add(m.parsed_control_id); cloned_standalone += 1

    if progress_cb:
        progress_cb(85, 100, f"Adding {ufw.name} controls onto the baseline…")

    # 4) ADD the new framework's controls — join a matched set, else standalone
    rows = _new_framework_controls(db, ufw_id)
    pc = {p.id: p for p in rows}
    added_join = 0; added_standalone = 0
    set_domain = {nc.name: (nc.domain or "Other / Uncategorized") for nc in old_ncs}
    for pid, set_name in mapping.items():
        p = pc.get(pid)
        if not p:
            continue
        if set_name and set_name in setname_ncid:
            ncid = setname_ncid[set_name]; gid = setname_group[set_name]
            db.add(NormalizedControlLink(normalized_control_id=ncid, parsed_control_id=pid,
                                         mapping_type="direct"))
            db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=pid,
                                             mapping_source="domain", mapping_confidence=0.9))
            added_join += 1
        else:
            # standalone — reconciled onto an EXISTING canonical domain (Step 3),
            # so it never spawns a new/duplicate domain.
            dom = dom_map.get(pid) or "Operations & IT Service Management"
            db.add(CommonControlGroupMapping(group_id=group_for(dom), parsed_control_id=pid,
                                             mapping_source="standalone", mapping_confidence=0.9))
            added_standalone += 1

    run.status = "completed"; run.completed_at = func.now()
    run.summary = {
        "extended_from_baseline": base.id, "added_framework": ufw.name, "added_framework_id": ufw_id,
        "cloned_sets": cloned_sets, "cloned_standalone": cloned_standalone,
        "added_join": added_join, "added_standalone": added_standalone,
        "master_list": [nc.name for nc in old_ncs],
    }

    if promote:
        # demote the old baseline, promote the new run (mirror of routers promote logic)
        db.query(NormalizationRun).filter(NormalizationRun.tenant_id == tenant_id,
                                          NormalizationRun.is_baseline.is_(True)).update(
            {NormalizationRun.is_baseline: False})
        run.is_baseline = True
    db.commit()

    return {
        "candidate_run_id": run.id, "promoted": promote,
        "added_framework": ufw.name, "added_join": added_join, "added_standalone": added_standalone,
        "cloned_sets": cloned_sets, "cloned_standalone": cloned_standalone,
    }


# ── recommended-evidence generation for the new framework's controls ─────────

def _infer_etype(text: str) -> str:
    t = (text or "").lower()
    pairs = [(("encrypt", "cryptograph", "key ", "tls", "cipher"), "configuration"),
             (("firewall", "network", "segment", "perimeter", "wireless", "remote access"), "configuration"),
             (("log", "monitor", "siem", "audit trail", "detect", "alert"), "log"),
             (("incident", "breach", "forensic", "response"), "procedure"),
             (("backup", "recovery", "continuity", "restore", "redundan"), "procedure"),
             (("vulnerab", "patch", "penetration", "scan"), "report"),
             (("training", "awareness"), "training"),
             (("vendor", "supplier", "third party", "third-party", "contract", "cloud"), "report"),
             (("physical", "facility", "entry", "equipment", "environmental"), "record"),
             (("asset", "inventory", "classif", "configuration", "baseline", "change"), "record"),
             (("risk", "assessment", "treatment"), "report"),
             (("policy", "policies", "governance", "roles", "responsibilit"), "policy")]
    for kws, et in pairs:
        if any(k in t for k in kws):
            return et
    return "document"


def generate_evidence(db: Session, ufw_id: int) -> int:
    """Generate recommended evidence for the new framework's controls that have
    none (our seed ships controls only). Writes ControlEvidenceRequirement rows so
    the evidence shows up in the normal evidence UI. Returns # controls covered."""
    from ....models import ControlEvidenceRequirement  # local import (avoid cycles)
    rows = _new_framework_controls(db, ufw_id)
    covered = 0
    for p in rows:
        existing = db.query(ControlEvidenceRequirement).filter(
            ControlEvidenceRequirement.parsed_control_id == p.id).count()
        if existing:
            continue
        title = (p.title or p.control_id or "Control").strip()
        body = f"{title} {p.description or p.full_text or ''}"
        impl_type = _infer_etype(body)
        items = [
            (f"{title} — documented policy/procedure",
             f"Approved document that establishes and describes how the requirement '{title}' is met.",
             "policy"),
            (f"{title} — implementation evidence",
             f"Evidence demonstrating the control is operating (e.g. {impl_type}) for '{title}'.",
             impl_type),
        ]
        for idx, (etitle, edesc, et) in enumerate(items):
            db.add(ControlEvidenceRequirement(
                framework_id=ufw_id, parsed_control_id=p.id,
                evidence_title=etitle[:500], evidence_description=edesc,
                evidence_type=et, evidence_format="document",
                exact_requirements=[edesc],
                acceptance_criteria=["Document is current and complete", "Properly approved/signed as required"],
                collection_guidance="Collect from the responsible system or team.",
                collection_frequency="annually", retention_period="3 years",
                ai_confidence=0.7, ai_reasoning="Auto-generated during framework absorption",
                status="draft", priority=(p.priority or "medium"),
                display_order=idx + 1, is_mandatory=True, is_active=True))
        covered += 1
    db.commit()
    return covered


# ── "pending" detection: active frameworks not yet in the live baseline ──────

def pending_frameworks(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Active frameworks whose controls are NOT yet part of the live baseline run.
    These are the ones the auto-absorb pipeline should pick up."""
    from sqlalchemy import or_
    base = get_baseline_run(db, tenant_id)
    base_ids = set(base.framework_ids or []) if base else set()
    # Pending = a sandbox upload (hidden test framework) OR an active framework not
    # yet in the baseline. Sandbox uploads stay isolated from the rest of the app.
    fws = db.query(UploadedFramework).filter(
        or_(UploadedFramework.upload_status == "sandbox",
            UploadedFramework.is_active.is_(True))).all()
    pending = []
    for f in fws:
        if f.id in base_ids:
            continue
        n = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == f.id).count()
        pending.append({"id": f.id, "name": f.name, "controls": n,
                        "domains": len({(c.domain or "").strip() for c in db.query(ParsedFrameworkControl.domain).filter(
                            ParsedFrameworkControl.uploaded_framework_id == f.id).all() if c.domain})})
    return {"baseline_run_id": base.id if base else None,
            "in_baseline": len(base_ids), "pending": pending}


# ── artifacts: the framework brings its own; ingest + normalize them ─────────

def framework_key_for(name: str) -> str:
    """Stable catalog key for a framework name (matches artifact_catalog.json style)."""
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return (s[:64] or "framework")


def ingest_artifacts(db: Session, ufw_id: int, artifacts: List[dict]) -> int:
    """Load the framework's OWN artifacts (carried in the seed) into the master
    artifact catalog under its framework_key. Called at upload time so the new
    framework brings its artifacts just like the existing 30 do."""
    from ....models import ArtifactCatalogItem
    ufw = db.query(UploadedFramework).filter(UploadedFramework.id == ufw_id).first()
    if not ufw or not artifacts:
        return 0
    fkey = framework_key_for(ufw.name)
    made = 0
    for i, a in enumerate(artifacts, start=1):
        if not isinstance(a, dict):
            continue
        aid = str(a.get("artifact_id") or f"ART-{i:03d}")
        if db.query(ArtifactCatalogItem).filter(
                ArtifactCatalogItem.framework_key == fkey,
                ArtifactCatalogItem.artifact_id == aid).first():
            continue
        db.add(ArtifactCatalogItem(
            framework_key=fkey, framework_name=(ufw.name or "")[:255], artifact_id=aid[:50],
            stage=(a.get("stage") or "Stage 1")[:100], stage_number=a.get("stage_number"),
            name=(a.get("name") or "Artifact")[:500],
            artifact_type=(a.get("type") or a.get("artifact_type") or "Document")[:100],
            control_ref=(a.get("control_ref") or None), mandatory=bool(a.get("mandatory", False)),
            description=a.get("description"), format=(a.get("format") or None), owner=(a.get("owner") or None)))
        made += 1
    db.commit()
    return made


def _norm_txt(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def normalize_evidence(db: Session, candidate_run_id: int, ufw_id: int,
                       mapping: Dict[int, Optional[str]]) -> Dict[str, Any]:
    """Normalize the framework's evidence onto the unified library: a control that
    JOINS an existing set has its evidence merged into that set's recommended_evidence
    (deduped); a STANDALONE control keeps its own. Mutates the candidate run only."""
    rows = _new_framework_controls(db, ufw_id)
    pc = {p.id: p for p in rows}
    cand_ncs = {nc.name: nc for nc in db.query(NormalizedControl).filter(
        NormalizedControl.run_id == candidate_run_id).all()}
    merged = 0
    deduped = 0
    enriched: set = set()
    for pid, set_name in mapping.items():
        if not set_name:
            continue  # standalone — evidence already carried on the control itself
        nc = cand_ncs.get(set_name)
        p = pc.get(pid)
        if not nc or not p:
            continue
        ev = list(nc.recommended_evidence or [])
        have = {_norm_txt(x if isinstance(x, str) else (x.get("name") or x.get("title") or "")) for x in ev}
        for item in (p.evidence_requirements or []):
            txt = item if isinstance(item, str) else (item.get("title") or item.get("name") or "")
            if not txt:
                continue
            if _norm_txt(txt) in have:
                deduped += 1
                continue
            ev.append(txt); have.add(_norm_txt(txt)); merged += 1
            enriched.add(nc.id)
        if nc.id in enriched:
            nc.recommended_evidence = ev  # reassign so SQLAlchemy flags the JSON column dirty
    db.commit()
    return {"evidence_merged": merged, "evidence_deduped": deduped,
            "sets_evidence_enriched": len(enriched)}


def normalize_artifacts(db: Session, tenant_id: int, ufw_id: int) -> Dict[str, Any]:
    """Normalize the framework's artifacts against the unified artifact catalog:
    each is either NEW (adds coverage) or a DUPLICATE of an artifact an existing
    framework already contributes (same document, different framework). Read-only."""
    from ....models import ArtifactCatalogItem
    ufw = db.query(UploadedFramework).filter(UploadedFramework.id == ufw_id).first()
    if not ufw:
        return {"artifacts_total": 0, "artifacts_new": 0, "artifacts_duplicate": 0,
                "artifacts_new_sample": [], "artifacts_dup_sample": []}
    fkey = framework_key_for(ufw.name)
    new_arts = db.query(ArtifactCatalogItem).filter(ArtifactCatalogItem.framework_key == fkey).all()
    others = db.query(ArtifactCatalogItem).filter(ArtifactCatalogItem.framework_key != fkey).all()
    existing = {}
    for o in others:
        existing.setdefault(_norm_txt(o.name), o)
    new: List[dict] = []
    dup: List[dict] = []
    for a in new_arts:
        key = _norm_txt(a.name)
        match = existing.get(key)
        if not match:
            at = set(key.split())
            for k, o in existing.items():
                ot = set(k.split())
                if at and ot and len(at & ot) / max(1, min(len(at), len(ot))) >= 0.7:
                    match = o
                    break
        if match:
            dup.append({"artifact": a.name, "type": a.artifact_type,
                        "matches": match.name, "in_framework": match.framework_name})
        else:
            new.append({"artifact": a.name, "type": a.artifact_type, "control_ref": a.control_ref})
    return {"artifacts_total": len(new_arts), "artifacts_new": len(new),
            "artifacts_duplicate": len(dup),
            "artifacts_new_sample": new[:40], "artifacts_dup_sample": dup[:40]}


# ── mock/duplicate-library view: how the new framework lands in the clone ────

def candidate_placements(db: Session, tenant_id: int, run_id: int, ufw_id: int) -> Dict[str, Any]:
    """Describe the CANDIDATE run as a duplicate library and show exactly where the
    new framework's controls landed in it — for the on-page mock-library view and
    the Excel export. Read-only; the live baseline is never read for mutation."""
    base = get_baseline_run(db, tenant_id)
    cand = db.query(NormalizationRun).filter(
        NormalizationRun.id == run_id, NormalizationRun.tenant_id == tenant_id).first()
    if not cand:
        raise RuntimeError(f"Candidate run {run_id} not found.")
    ufw = db.query(UploadedFramework).filter(UploadedFramework.id == ufw_id).first()
    rows = _new_framework_controls(db, ufw_id)
    pc = {p.id: p for p in rows}

    cand_ncs = {nc.id: nc for nc in db.query(NormalizedControl).filter(NormalizedControl.run_id == cand.id).all()}
    cand_groups = {g.id: (g.domain or g.name or "Other / Uncategorized")
                   for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id == cand.id).all()}

    # joins: the fw's parsed controls linked to a candidate normalized set
    joined: Dict[int, tuple] = {}
    if pc and cand_ncs:
        for ln in db.query(NormalizedControlLink).filter(
                NormalizedControlLink.normalized_control_id.in_(list(cand_ncs)),
                NormalizedControlLink.parsed_control_id.in_(list(pc))).all():
            nc = cand_ncs.get(ln.normalized_control_id)
            if nc and ln.parsed_control_id not in joined:
                joined[ln.parsed_control_id] = (nc.name, nc.domain or "—")
    # standalone: the fw's parsed controls mapped straight into a candidate domain group
    standalone: Dict[int, str] = {}
    if pc and cand_groups:
        for m in db.query(CommonControlGroupMapping).filter(
                CommonControlGroupMapping.group_id.in_(list(cand_groups)),
                CommonControlGroupMapping.parsed_control_id.in_(list(pc)),
                CommonControlGroupMapping.mapping_source == "standalone").all():
            standalone.setdefault(m.parsed_control_id, cand_groups.get(m.group_id) or "—")

    placements: List[dict] = []
    per_domain_added: Dict[str, int] = {}
    for pid, p in pc.items():
        if pid in joined:
            sname, dom = joined[pid]
            disp, jset, canon = "joined", sname, dom
        elif pid in standalone:
            disp, jset, canon = "standalone", None, standalone[pid]
        else:
            disp, jset, canon = "unplaced", None, "—"
        placements.append({
            "control_id": p.control_id, "title": (p.title or "")[:160],
            "framework_domain": p.domain or "—", "canonical_domain": canon,
            "disposition": disp, "joined_set": jset})
        per_domain_added[canon] = per_domain_added.get(canon, 0) + 1
    placements.sort(key=lambda r: (r["canonical_domain"], r["control_id"]))

    # composition: baseline per-domain nc counts vs the mock copy + new additions
    base_total = db.query(NormalizedControl).filter(NormalizedControl.run_id == base.id).count() if base else 0
    base_domains = db.query(CommonControlGroup).filter(CommonControlGroup.run_id == base.id).count() if base else 0
    base_dom_counts: Dict[str, int] = {}
    if base:
        for (dom,) in db.query(NormalizedControl.domain).filter(NormalizedControl.run_id == base.id).all():
            d = dom or "—"
            base_dom_counts[d] = base_dom_counts.get(d, 0) + 1
    all_domains = sorted(set(base_dom_counts) | set(per_domain_added))
    per_domain = [{"domain": d, "baseline": base_dom_counts.get(d, 0),
                   "added": per_domain_added.get(d, 0),
                   "total": base_dom_counts.get(d, 0) + per_domain_added.get(d, 0)} for d in all_domains]

    # evidence generated for this framework
    from ....models import ControlEvidenceRequirement
    ev_rows = db.query(ControlEvidenceRequirement).filter(
        ControlEvidenceRequirement.framework_id == ufw_id).all()
    pid_code = {p.id: (p.control_id, p.title) for p in rows}
    evidence = [{"control_id": pid_code.get(e.parsed_control_id, ("—", ""))[0],
                 "control_title": pid_code.get(e.parsed_control_id, ("", ""))[1],
                 "evidence_title": e.evidence_title, "evidence_type": e.evidence_type}
                for e in ev_rows]
    evidence.sort(key=lambda r: r["control_id"])

    join_n = sum(1 for p in placements if p["disposition"] == "joined")
    std_n = sum(1 for p in placements if p["disposition"] == "standalone")
    artn = normalize_artifacts(db, tenant_id, ufw_id)
    return {
        "candidate_run_id": cand.id,
        "framework": ufw.name if ufw else "?", "framework_id": ufw_id,
        "live": {"total": base_total, "domains": base_domains, "run_id": base.id if base else None},
        "mock": {"total": len(cand_ncs), "domains": len(cand_groups),
                 "added_join": join_n, "added_standalone": std_n,
                 "new_entries": std_n, "enriched_sets": join_n},
        "per_domain": per_domain,
        "placements": placements,
        "evidence": evidence,
        "artifacts": artn,
    }


# ── phased orchestrator (what the live UI watches) ───────────────────────────

PHASES = [
    ("read",      "Reading new controls, evidence & artifacts"),
    ("domains",   "Reconciling domains onto the existing library"),
    ("normalize", "Normalizing controls (join sets vs standalone)"),
    ("build",     "Building a safe candidate library"),
    ("evidence",  "Normalizing evidence onto sets"),
    ("artifacts", "Normalizing artifacts into the catalog"),
]


def run_absorption(db: Session, tenant_id: int, ufw_id: int, *, get_client: Callable[[], Any],
                   user_id: Optional[int] = None, promote: bool = False,
                   progress: Optional[Callable] = None) -> Dict[str, Any]:
    """Run the full absorb pipeline for ONE framework, emitting phase progress via
    `progress(phase, percent, message, extra_dict)`. Produces a CANDIDATE run
    (promote=False by default) so the live baseline is never touched until the
    user keeps it."""
    t0 = time.time()
    trace: Dict[str, Any] = {"framework_id": ufw_id, "tenant_id": tenant_id,
                             "started_epoch": t0, "no_chunking": True, "steps": []}

    def _write_trace():
        try:
            d = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))), "pipeline_traces")
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, f"trace_fw{ufw_id}.json"), "w", encoding="utf-8") as f:
                json.dump(trace, f, ensure_ascii=False, indent=2)
        except Exception:
            logger.exception("could not write pipeline trace")

    def emit(phase, pct, msg, **extra):
        # record the step in the trace (with elapsed time) and stream it out
        trace["steps"].append({"phase": phase, "percent": pct, "message": msg,
                               "elapsed_s": round(time.time() - t0, 2), **extra})
        trace["elapsed_s"] = round(time.time() - t0, 2)
        _write_trace()
        if progress:
            progress(phase, pct, msg, extra)

    base = get_baseline_run(db, tenant_id)
    if not base:
        raise RuntimeError("No baseline run exists — build the baseline first.")
    ufw = db.query(UploadedFramework).filter(UploadedFramework.id == ufw_id).first()
    if not ufw:
        raise RuntimeError(f"UploadedFramework {ufw_id} not found.")
    trace["framework"] = ufw.name
    rows = _new_framework_controls(db, ufw_id)

    # Phase 1 — read (controls + their evidence + the framework's artifacts)
    from ....models import ControlEvidenceRequirement, ArtifactCatalogItem
    ev_in = db.query(ControlEvidenceRequirement).filter(
        ControlEvidenceRequirement.framework_id == ufw_id).count()
    art_in = db.query(ArtifactCatalogItem).filter(
        ArtifactCatalogItem.framework_key == framework_key_for(ufw.name)).count()
    emit("read", 8,
         f"Found {len(rows)} controls, {ev_in} evidence items and {art_in} artifacts in “{ufw.name}”.",
         new_controls=len(rows), evidence_in=ev_in, artifacts_in=art_in, framework=ufw.name)

    # Phase 2 — reconcile domains (Step 3)
    emit("domains", 22, "Merging the framework's domains into your existing domains…")
    dom_map = classify_domains(db, ufw_id, base, get_client=get_client)
    canonical = set(_baseline_view(db, base)["domains"])
    domains_used = sorted({d for d in dom_map.values() if d})
    new_domains = sorted(set(domains_used) - canonical)
    emit("domains", 42,
         f"Mapped onto {len(domains_used)} existing domains — {len(new_domains)} new domains created.",
         domains_used=domains_used, new_domains=new_domains)

    # Phase 3 — normalize (join vs standalone) + adversarial verification of joins.
    # DOMAIN-SCOPED: match each control only against sets in its reconciled domain.
    emit("normalize", 52, "Matching each control to sets in its domain…")
    mapping = classify_onto_baseline(db, ufw_id, base, get_client=get_client, dom_map=dom_map)
    prelim_joins = sum(1 for v in mapping.values() if v)
    emit("normalize", 62,
         f"{prelim_joins} candidate joins — verifying each is a genuine match…",
         would_join=prelim_joins, would_standalone=len(rows) - prelim_joins)
    vstats = _verify_joins(db, base, mapping, rows, get_client=get_client)
    joins = sum(1 for v in mapping.values() if v)
    standalone = len(rows) - joins
    emit("normalize", 70,
         f"{joins} controls join existing sets, {standalone} standalone "
         f"(verification demoted {vstats['demoted']} weak matches to their own set).",
         would_join=joins, would_standalone=standalone,
         joins_verified_kept=vstats["kept"], joins_demoted=vstats["demoted"],
         demoted_items=vstats["demoted_items"])

    # Phase 4 — build candidate
    emit("build", 80, "Cloning your library into a safe candidate and adding the framework…")
    res = commit(db, tenant_id, ufw_id, get_client=get_client, user_id=user_id,
                 label=f"Auto-absorb: {ufw.name}", promote=promote,
                 mapping=mapping, dom_map=dom_map)
    cand = res["candidate_run_id"]
    # Single source of truth: report what commit ACTUALLY placed, not the pre-estimate.
    joins = res["added_join"]; standalone = res["added_standalone"]
    emit("build", 90, f"Candidate library #{cand} built (your live library is untouched).",
         candidate_run_id=cand, would_join=joins, would_standalone=standalone)

    # Phase 5 — normalize EVIDENCE (merge joined controls' evidence onto their sets;
    #           generate recommended evidence for any control that shipped none)
    emit("evidence", 92, "Normalizing evidence — merging onto matched sets…")
    gen = generate_evidence(db, ufw_id)                      # only controls with no evidence
    evn = normalize_evidence(db, cand, ufw_id, mapping)      # merge joined evidence onto sets
    emit("evidence", 96,
         f"Merged {evn['evidence_merged']} evidence items into {evn['sets_evidence_enriched']} sets "
         f"({evn['evidence_deduped']} already covered).", **evn, evidence_generated=gen)

    # Phase 6 — normalize ARTIFACTS (dedup the framework's artifacts vs the catalog)
    emit("artifacts", 98, "Normalizing artifacts against the unified catalog…")
    artn = normalize_artifacts(db, tenant_id, ufw_id)
    emit("artifacts", 100,
         f"{artn['artifacts_new']} new artifacts added, {artn['artifacts_duplicate']} deduped "
         f"against existing frameworks.", **{k: artn[k] for k in
         ("artifacts_total", "artifacts_new", "artifacts_duplicate")})

    # per-control decisions → trace (full record of how each control was placed)
    pc = {p.id: p for p in rows}
    decisions = []
    for pid, p in pc.items():
        sn = mapping.get(pid)
        decisions.append({"control_id": p.control_id, "title": p.title,
                          "framework_domain": p.domain,
                          "reconciled_domain": dom_map.get(pid),
                          "disposition": "joined" if sn else "standalone",
                          "joined_set": sn})
    result = {**res, "new_controls": len(rows), "would_join": joins, "would_standalone": standalone,
              "domains_used": domains_used, "new_domains": new_domains,
              "evidence_generated": gen, **evn, **artn,
              "joins_verified_kept": vstats["kept"], "joins_demoted": vstats["demoted"],
              "demoted_items": vstats["demoted_items"],
              "framework": ufw.name, "promoted": promote}
    trace["decisions"] = decisions
    trace["result"] = result
    trace["completed"] = True
    trace["total_seconds"] = round(time.time() - t0, 2)
    _write_trace()
    return result
