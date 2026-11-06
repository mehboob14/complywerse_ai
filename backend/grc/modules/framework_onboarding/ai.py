"""AI help inside a framework onboarding (plan section 7.5): drafts the person accepts, edits or dismisses. The call never saves anything.

Four kinds, each started by a click: ``scope_draft`` (a scope statement from the sites, systems and units picked), ``exclusions_check``
(what was left out that an auditor will ask about), ``parties_suggest`` (interested parties from the regulators and third parties already in
the profile) and ``gap_review`` (what an auditor of this family would ask next, quoting the field).

The prompt carries the organisation's own rows (names, kinds, countries) and the catalog's field labels; no SCF text and no licensed text. The
data-protection guard in the OpenAI shim replaces names before the call and restores them after (``AIBlocked`` is its refusal and is never
swallowed). When AI is not configured, or its answer cannot be used, the same four helpers answer from rules and say so (``by: "rules"``)."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ...config import get_openai_model
from ...models import FrameworkOnboarding, GRCUser
from ...services.ai_gateway.errors import AIBlocked
from . import catalog, engine, profile, service

logger = logging.getLogger(__name__)

KINDS = ("scope_draft", "exclusions_check", "parties_suggest", "gap_review")
SYSTEM = ("You are an experienced compliance consultant helping an organisation prepare to start a compliance programme. Use only the facts you are given, "
          "do not invent sites, systems, people, regulators or figures, write plainly and briefly, and answer with valid JSON only, in exactly the shape asked.")
ROWS_CAP = 40


class AIUnusable(Exception):
    """The provider could not be reached or its answer could not be used: the caller falls back to rules."""


def _ask_json(prompt: str) -> Dict[str, Any]:
    from ...services.openai_client import check_ai_available, get_openai_client

    if not check_ai_available():
        raise AIUnusable("not configured")
    try:
        completion = get_openai_client().chat.completions.create(
            model=get_openai_model(), temperature=0.3,
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}])
    except AIBlocked:
        raise
    except Exception:       # noqa: BLE001 - a provider failure becomes a rule-based answer, never its own text
        logger.exception("framework onboarding AI: the call failed")
        raise AIUnusable("call failed") from None
    choice = completion.choices[0] if getattr(completion, "choices", None) else None
    if choice is None or getattr(choice, "finish_reason", None) == "length":
        raise AIUnusable("cut off")
    text = (getattr(choice.message, "content", "") or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        text = text[:-3] if text.endswith("```") else text
    try:
        out = json.loads(text.strip())
    except (TypeError, ValueError):
        raise AIUnusable("not JSON") from None
    if not isinstance(out, dict) or not out:
        raise AIUnusable("empty")
    return out


def _clip(v: Any, n: int) -> str:
    return " ".join(str(v or "").split())[:n].strip()


# --------------------------------------------------------------------------- context
def _context(db: Session, ob: FrameworkOnboarding) -> Dict[str, Any]:
    org = profile.merged_values(db, ob.tenant_id)
    rows = service._org_rows(org)
    refs = profile.refs_for(db, ob.tenant_id, org)
    res = catalog.resolve(ob.framework_slug)
    scope_step = (ob.answers or {}).get("scope") or {}
    picked: Dict[str, List[str]] = {}
    for st in res["steps"]:
        for f in st["fields"]:
            if f["type"] == "org_pick":
                ids = (ob.answers or {}).get(st["key"], {}).get(f["key"]) or []
                if f["of"] in ("systems",):
                    picked.setdefault("systems", []).extend(refs["assets"].get(i, {}).get("name", "") for i in ids)
                elif f["of"] == "departments":
                    picked.setdefault("units", []).extend(refs["departments"].get(i, "") for i in ids)
                else:
                    byid = {r["id"]: r for r in rows.get(f["of"], [])}
                    picked.setdefault(f["of"], []).extend(_clip(byid[i].get("name"), 120) for i in ids if i in byid)
    e = org.get("entities_sites") or {}
    return {
        "res": res, "org": org, "rows": rows, "refs": refs, "picked": {k: [x for x in v if x] for k, v in picked.items()},
        "legal_entity": e.get("legal_entity"), "industry": e.get("industry"), "scope_statement": _clip(scope_step.get("statement"), 600),
    }


def _names(rows: List[Dict[str, Any]], *cols: str) -> List[str]:
    out = []
    for r in rows[:ROWS_CAP]:
        label = " - ".join(_clip(r.get(c), 80) for c in cols if r.get(c))
        if label:
            out.append(label)
    return out


# --------------------------------------------------------------------------- the four kinds
def scope_draft(db: Session, ob: FrameworkOnboarding, ctx: Dict[str, Any]) -> Dict[str, Any]:
    p = ctx["picked"]
    facts = {
        "framework": ctx["res"]["label"], "organisation": ctx["legal_entity"], "industry": ctx["industry"], "entities": p.get("entities", []),
        "sites": p.get("sites", []), "systems": p.get("systems", []), "units": p.get("units", []), "outsourced": p.get("third_parties", []),
    }

    def rules() -> Dict[str, Any]:
        parts = [f"The {ctx['res']['label'] or 'framework'} scope covers"]
        if p.get("entities") or ctx["legal_entity"]:
            parts.append(", ".join(p.get("entities") or [ctx["legal_entity"]]))
        if p.get("sites"):
            parts.append("at " + ", ".join(p["sites"]))
        if p.get("systems"):
            parts.append("including " + ", ".join(p["systems"][:8]))
        if p.get("units"):
            parts.append("and the " + ", ".join(p["units"]) + " units")
        return {"statement": " ".join(parts).strip() + "."}

    try:
        out = _ask_json("Draft a scope statement (two or three sentences) for the compliance programme below. Say what is covered, where and for whom. "
                        "Use only these facts; leave out anything not listed. Answer as {\"statement\": \"...\"}.\n" + json.dumps(facts, ensure_ascii=False))
        text = _clip(out.get("statement"), 1200)
        if not text:
            raise AIUnusable("empty")
        return {"suggestion": {"statement": text}, "by": "ai"}
    except AIUnusable:
        return {"suggestion": rules(), "by": "rules"}


def exclusions_check(db: Session, ob: FrameworkOnboarding, ctx: Dict[str, Any]) -> Dict[str, Any]:
    rows = ctx["rows"]
    candidates = {"sites": [r.get("name") for r in rows.get("sites", []) if r.get("name")],
                  "entities": [r.get("name") for r in rows.get("entities", []) if r.get("name")]}
    picked = {k: set(ctx["picked"].get(k, [])) for k in candidates}
    left_out = {k: [n for n in v if n not in picked[k]] for k, v in candidates.items()}

    def rules() -> Dict[str, Any]:
        items = [{"item": n, "reason": ""} for k in ("sites", "entities") for n in left_out[k]][:ROWS_CAP]
        return {"exclusions": items, "questions": []}

    if not any(left_out.values()):
        return {"suggestion": {"exclusions": [], "questions": []}, "by": "rules"}
    try:
        out = _ask_json("These sites and legal entities of the organisation are NOT inside the scope. For each, say whether leaving it out needs a written reason "
                        "an auditor would expect, and add one short question the auditor would ask about the exclusion. Use only the names given. "
                        "Answer as {\"exclusions\": [{\"item\": name, \"reason\": suggested wording}], \"questions\": [{\"item\": name, \"why\": question}]}.\n"
                        + json.dumps({"scope": ctx["scope_statement"], "left_out": left_out}, ensure_ascii=False))
        allowed = {n.lower(): n for v in left_out.values() for n in v}
        ex = [{"item": allowed[_clip(x.get("item"), 200).lower()], "reason": _clip(x.get("reason"), 400)}
              for x in out.get("exclusions") or [] if isinstance(x, dict) and _clip(x.get("item"), 200).lower() in allowed]
        qs = [{"item": allowed[_clip(x.get("item"), 200).lower()], "why": _clip(x.get("why"), 300)}
              for x in out.get("questions") or [] if isinstance(x, dict) and _clip(x.get("item"), 200).lower() in allowed]
        if not ex and not qs:
            raise AIUnusable("nothing usable")
        return {"suggestion": {"exclusions": ex[:ROWS_CAP], "questions": qs[:ROWS_CAP]}, "by": "ai"}
    except AIUnusable:
        return {"suggestion": rules(), "by": "rules"}


def parties_suggest(db: Session, ob: FrameworkOnboarding, ctx: Dict[str, Any]) -> Dict[str, Any]:
    org = ctx["org"]
    regs = (org.get("regulators_obligations") or {}).get("regulators") or []
    third = (org.get("data_systems") or {}).get("third_parties") or []
    kinds = ["Customer", "Regulator", "Employee", "Supplier", "Owner or board", "Partner", "Public"]

    def rules() -> Dict[str, Any]:
        rows = [{"party": _clip(r.get("regulator"), 120), "kind": "Regulator", "requirement": "Compliance with its requirements and filings."}
                for r in regs if r.get("regulator")]
        rows += [{"party": _clip(r.get("name"), 120), "kind": "Supplier", "requirement": _clip(r.get("service"), 160) or "Secure delivery of the service."}
                 for r in third if r.get("name")]
        rows.append({"party": "Employees", "kind": "Employee", "requirement": "Clear responsibilities and protection of their data."})
        return {"rows": rows[:12]}

    try:
        out = _ask_json("Suggest the interested parties of this organisation's management system and, for each, its requirement. Base them on the regulators and "
                        f"third parties listed; kind must be one of {kinds}. Answer as {{\"rows\": [{{\"party\": ..., \"kind\": ..., \"requirement\": ...}}]}}.\n"
                        + json.dumps({"organisation": ctx["legal_entity"], "industry": ctx["industry"], "regulators": _names(regs, "regulator", "country"),
                                      "third_parties": _names(third, "name", "service")}, ensure_ascii=False))
        rows = [{"party": _clip(r.get("party"), 120), "kind": r.get("kind") if r.get("kind") in kinds else "Partner",
                 "requirement": _clip(r.get("requirement"), 240)}
                for r in out.get("rows") or [] if isinstance(r, dict) and _clip(r.get("party"), 120) and _clip(r.get("requirement"), 240)]
        if not rows:
            raise AIUnusable("nothing usable")
        return {"suggestion": {"rows": rows[:12]}, "by": "ai"}
    except AIUnusable:
        return {"suggestion": rules(), "by": "rules"}


def gap_review(db: Session, ob: FrameworkOnboarding, ctx: Dict[str, Any]) -> Dict[str, Any]:
    res, org = ctx["res"], ctx["org"]
    ev = engine.evaluate(res, ob.answers or {}, org)
    labels = {f"{s['key']}.{f['key']}": f["label"] for s in res["steps"] for f in s["fields"]}
    open_keys = [c["key"] for c in ev["checks"] if not c["ok"] and c.get("kind") == "field"][:20]

    def rules() -> Dict[str, Any]:
        qs = [{"field": k, "question": f"{labels.get(k, k)}: what is the answer, and what evidence shows it?"} for k in open_keys]
        qs += [{"field": c["key"], "question": c["label"] + "."} for c in ev["checks"] if not c["ok"] and c.get("kind") == "gate"]
        return {"questions": qs[:10]}

    try:
        out = _ask_json(f"Read this onboarding draft for {res['label']} as the auditor or regulator who will assess it. List up to eight questions they would ask next, "
                        "each tied to one of the fields given (use the field key). Quote the field's current answer when it is thin. "
                        "Answer as {\"questions\": [{\"field\": key, \"question\": text}]}.\n"
                        + json.dumps({"fields": labels, "answers": ob.answers or {}, "open": open_keys}, ensure_ascii=False)[:9000])
        qs = [{"field": x.get("field"), "question": _clip(x.get("question"), 300)} for x in out.get("questions") or []
              if isinstance(x, dict) and x.get("field") in labels and _clip(x.get("question"), 300)]
        if not qs:
            raise AIUnusable("nothing usable")
        return {"suggestion": {"questions": qs[:10]}, "by": "ai"}
    except AIUnusable:
        return {"suggestion": rules(), "by": "rules"}


def run(db: Session, ob: FrameworkOnboarding, user: GRCUser, kind: str) -> Dict[str, Any]:
    """One suggestion of ``kind`` for this onboarding. Reads only; the person decides what to keep."""
    if kind not in KINDS:
        raise service.OnboardingError(404, "Unknown kind of help.")
    ctx = _context(db, ob)
    out = {"scope_draft": scope_draft, "exclusions_check": exclusions_check, "parties_suggest": parties_suggest, "gap_review": gap_review}[kind](db, ob, ctx)
    return {"kind": kind, **out}
