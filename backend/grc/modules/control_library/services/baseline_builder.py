"""First-time / rebuild MASTER BASELINE builder — the AI normalization pipeline
behind the 'Create Master Baseline' button.

GLOBAL view, no chunked clustering: discover candidate control-families across ALL
controls (accumulating shared vocabulary), MERGE synonyms into one canonical list,
then classify every control against that FIXED list (full list in every call -> no
chunk boundary separates equivalents). Group by family -> unified (>=2 frameworks) /
standalone, under 18 domains. Built into a NEW NormalizationRun (is_baseline=False) —
the caller reviews it and PROMOTES it; the live baseline is never touched here.
"""
from __future__ import annotations
import re, json
from collections import defaultdict, Counter
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from ....models import (
    NormalizedControl, NormalizedControlLink, CommonControlGroup,
    CommonControlGroupMapping, ParsedFrameworkControl, UploadedFramework, NormalizationRun,
)
from ....config import get_openai_model
from ..routers.groups import get_openai_client
from . import normalization as N

# The canonical 18 domains a control library is organised into.
DOMAINS = [
    "Governance, Risk & Compliance", "Access Control & Identity Management",
    "Data Protection & Privacy", "Network Security", "Cryptography & Key Management",
    "Logging, Monitoring & Detection", "Incident Management",
    "Business Continuity & Resilience", "Configuration & Change Management",
    "Asset Management", "Third-Party & Supply Chain Risk", "Physical & Environmental Security",
    "Human Resources Security", "Awareness & Training", "Application & Software Security",
    "Vulnerability & Threat Management", "Audit & Assurance", "Other / Uncategorized",
]
CAP_PER_FW = 8   # over-consolidation guard: max members from one framework per unified control


def _ai_json(client, sys, user, timeout=180):
    for _ in range(3):
        try:
            r = client.chat.completions.create(
                model=get_openai_model(), temperature=0, timeout=timeout,
                messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
                response_format={"type": "json_object"})
            return json.loads(r.choices[0].message.content or "{}")
        except Exception:
            continue
    return {}


def build_baseline_run(
    db: Session, tenant_id: int, *,
    label: Optional[str] = None, user_id: Optional[int] = None,
    progress_cb: Optional[Callable[[int, int, str], None]] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    client = get_openai_client()
    def prog(d, t, m):
        if should_cancel and should_cancel():
            raise N.AutoGroupCancelled()
        if progress_cb:
            progress_cb(d, t, m)

    fwn = {f.id: f.name for f in db.query(UploadedFramework).all()}
    parsed = (db.query(ParsedFrameworkControl)
              .join(UploadedFramework, ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id)
              .all())
    if len(parsed) < 2:
        raise ValueError("Need at least 2 framework controls to build a baseline.")
    members = [{"ref_id": p.id, "fwid": p.uploaded_framework_id,
                "framework": fwn.get(p.uploaded_framework_id, "?"),
                "name": (p.title or "")[:140], "text": (p.description or p.full_text or "")[:140]} for p in parsed]
    members = N._interleave_by_framework(members)
    prog(3, 100, f"Loaded {len(members)} controls across {len({m['fwid'] for m in members})} frameworks")

    # Domain per control: reuse the current baseline's mapping when present (rebuild),
    # else fall back to AI classification below.
    pid_domain: Dict[int, str] = {}
    cur_base = db.query(NormalizationRun).filter(
        NormalizationRun.tenant_id == tenant_id, NormalizationRun.is_baseline.is_(True)).first()
    if cur_base:
        bg = [g.id for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id == cur_base.id).all()]
        gid_dom = {g.id: (g.domain or g.name or "Other / Uncategorized")
                   for g in db.query(CommonControlGroup).filter(CommonControlGroup.run_id == cur_base.id).all()}
        if bg:
            for m in db.query(CommonControlGroupMapping).filter(
                    CommonControlGroupMapping.parsed_control_id.isnot(None),
                    CommonControlGroupMapping.group_id.in_(bg)).all():
                pid_domain.setdefault(m.parsed_control_id, gid_dom.get(m.group_id, "Other / Uncategorized"))

    # ── Phase A: discover candidate families (accumulating shared vocabulary) ──
    SYSA = ("You are a GRC taxonomist. Extract canonical SPECIFIC control-family names from these "
            "controls (e.g. 'Privileged Access Management','Data Encryption at Rest','Change Management'). "
            "Reuse an existing family verbatim when one fits; only add genuinely new specific families.")
    fams: Dict[str, str] = {}
    B = 70
    nb = (len(members) + B - 1) // B
    for bi, s in enumerate(range(0, len(members), B)):
        prog(5 + int(35 * bi / max(1, nb)), 100, f"Discovering control families ({bi+1}/{nb})…")
        batch = members[s:s+B]
        existing = ("\nExisting families (reuse verbatim when fitting):\n" + "\n".join(sorted(fams.values())[:400])) if fams else ""
        lines = "\n".join(f"({m['framework'][:16]}) {m['name']}: {m['text'][:90]}" for m in batch)
        d = _ai_json(client, SYSA, "Controls:\n" + lines + existing + '\n\nJSON: {"families":["..."]}')
        for f in d.get("families", []) or []:
            f = (f or "").strip()
            if f:
                fams.setdefault(re.sub(r"[^a-z0-9]+", " ", f.lower()).strip(), f)
    raw = sorted(fams.values())

    # ── Phase B: GLOBAL merge -> canonical specific families ──
    prog(42, 100, f"Consolidating {len(raw)} candidate families…")
    SYSB = ("You are a GRC taxonomist. Consolidate this candidate control-family list by merging "
            "SYNONYMS and near-duplicates that mean the SAME specific requirement into ONE canonical "
            "family. Keep families SPECIFIC (do NOT collapse different requirements into a broad "
            "domain). Return the final canonical list.")
    canon: List[str] = []
    for s in range(0, len(raw), 900):
        chunk = raw[s:s+900]
        d = _ai_json(client, SYSB, "Candidate families" + (" (plus already-canonical below, reuse them)" if canon else "") + ":\n"
                     + "\n".join(chunk) + ("\n\nAlready canonical:\n" + "\n".join(canon) if canon else "")
                     + '\n\nJSON: {"families":["..."]}', timeout=240)
        seen = {re.sub(r"[^a-z0-9]+", " ", c.lower()).strip() for c in canon}
        for f in d.get("families", []) or []:
            f = f.strip()
            k = re.sub(r"[^a-z0-9]+", " ", f.lower()).strip()
            if f and k not in seen:
                seen.add(k); canon.append(f)
    if not canon:
        canon = raw

    # ── Phase C: classify each control against the FIXED canonical list ──
    prog(48, 100, f"Classifying controls into {len(canon)} families…")
    tags = N._classify_to_taxonomy(client, members, canon, should_cancel=should_cancel)
    fam = defaultdict(list)
    for m, t in zip(members, tags):
        if t:
            fam[t].append(m)
    uni_fams = [(f, ms) for f, ms in fam.items() if len({m["fwid"] for m in ms}) >= 2]

    # ── Domain per family: reuse pid_domain majority, else AI-classify the family ──
    prog(70, 100, "Assigning domains…")
    fam_domain: Dict[str, str] = {}
    need_ai = []
    for f, ms in fam.items():
        doms = [pid_domain.get(m["ref_id"]) for m in ms if pid_domain.get(m["ref_id"])]
        if doms:
            fam_domain[f] = Counter(doms).most_common(1)[0][0]
        else:
            need_ai.append(f)
    for s in range(0, len(need_ai), 60):
        chunk = need_ai[s:s+60]
        d = _ai_json(client, "Map each control-family to EXACTLY one domain from the list (verbatim).",
                     "DOMAINS:\n" + "\n".join(f"- {x}" for x in DOMAINS) + "\n\nFamilies:\n"
                     + "\n".join(f"[{i}] {f}" for i, f in enumerate(chunk))
                     + '\n\nJSON: {"map":[{"i":0,"domain":"..."}]}')
        canon_dom = {re.sub(r"[^a-z0-9]+", " ", x.lower()).strip(): x for x in DOMAINS}
        for e in d.get("map", []) or []:
            try:
                i = int(e.get("i"))
            except (TypeError, ValueError):
                continue
            dm = canon_dom.get(re.sub(r"[^a-z0-9]+", " ", (e.get("domain") or "").lower()).strip())
            if dm and 0 <= i < len(chunk):
                fam_domain[chunk[i]] = dm
    dom_of_pid = lambda pid: pid_domain.get(pid, "Other / Uncategorized")

    # ── Persist into a NEW run (is_baseline stays False) ──
    prog(80, 100, "Building domain groups…")
    run = NormalizationRun(tenant_id=tenant_id, label=label or "Master baseline (candidate)",
                           scope="full", is_baseline=False, status="running", created_by=user_id)
    db.add(run); db.flush(); RID = run.id
    groups: Dict[str, int] = {}
    def group_for(domain):
        domain = domain or "Other / Uncategorized"
        if domain not in groups:
            g = CommonControlGroup(tenant_id=tenant_id, run_id=RID, code=f"FDOM-{len(groups)+1:02d}",
                                   name=domain, domain=domain, category=domain, created_by=user_id)
            db.add(g); db.flush(); groups[domain] = g.id
        return groups[domain]

    claimed = set(); seq = 0; n_uni = 0; n_std = 0
    for f, ms in uni_fams:
        # over-consolidation guard: cap members-per-framework
        byfw = defaultdict(list)
        for m in ms:
            byfw[m["fwid"]].append(m)
        keep = []
        for _fw, lst in byfw.items():
            keep += lst[:CAP_PER_FW]
        if len({m["fwid"] for m in keep}) < 2:
            continue
        dom = fam_domain.get(f) or Counter(dom_of_pid(m["ref_id"]) for m in keep).most_common(1)[0][0]
        gid = group_for(dom); seq += 1; n_uni += 1
        nc = NormalizedControl(code=f"NCF{seq:04d}", name=f[:250], source="ai_normalized",
                               run_id=RID, domain=dom, maturity_level=0, review_status="pending")
        db.add(nc); db.flush()
        db.add(CommonControlGroupMapping(group_id=gid, normalized_control_id=nc.id, mapping_source="domain", mapping_confidence=1.0))
        for m in keep:
            db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=m["ref_id"], mapping_type="direct"))
            db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=m["ref_id"], mapping_source="domain", mapping_confidence=1.0))
            claimed.add(m["ref_id"])
    # everything else -> standalone under its domain
    for m in members:
        if m["ref_id"] in claimed:
            continue
        gid = group_for(dom_of_pid(m["ref_id"]))
        db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=m["ref_id"], mapping_source="standalone", mapping_confidence=1.0))
        n_std += 1
    run.status = "completed"
    run.summary = {"unified_controls": n_uni, "standalone": n_std, "domains": len(groups)}
    db.commit()

    # ── Evidence ──
    prog(88, 100, f"Consolidating evidence for {n_uni} unified controls…")
    try:
        N._precompute_nc_evidence(db, client, run_id=RID)
    except Exception:
        pass
    prog(100, 100, f"Built {n_uni} unified + {n_std} standalone across {len(groups)} domains.")
    return {"run_id": RID, "unified_controls": n_uni, "standalone": n_std, "domains": len(groups)}
