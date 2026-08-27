"""AI-planned asset detail layout — Layer 2 on top of the generic renderer.

THE CONTRACT (owner-settled, 23 Aug):
  * Collected VALUES are sacred. They are never sent to, altered by, or invented
    by the model. The model only ever sees FIELD KEYS (plus a type hint) and
    returns, per key: a human heading, a card to group it under, and per card a
    size. The frontend then places the REAL values into that plan.
  * This is Layer 2. Layer 1 = the existing generic renderer in
    grc-frontend/.../assets/[id]/_overview-map.ts (blocksFor / toItems /
    humanize). If this service fails, times out, or returns anything that does
    not validate, the caller gets None and Layer 1 draws the page exactly as
    today. Never a blank screen.
  * Plans are cached per asset in grc_ai_recommendations (the existing generic
    per-tenant AI-output store) keyed by a hash of the KEY SET, so an asset is
    only re-planned when its collected fields actually change.

WHY AI HERE IS SAFE: the worst the model can do is pick a clumsy heading or the
wrong card for a key. The value underneath is always the collected truth, so a
mislabel is a cosmetic flaw, never a false fact. Compare the reverse (AI writing
values): one hallucinated "Antivirus: Windows Defender" is a false audit record.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MODULE = "asset_layout"
REC_TYPE = "overview_plan"
PROMPT_VERSION = "asset-layout-v1"

# The only cards the model may use. Anything else is rejected and the whole plan
# falls back — keeps the UI vocabulary fixed and prevents a runaway card zoo.
ALLOWED_CARDS = (
    "Identity", "Network", "Operating System", "Hardware", "Storage",
    "Security", "Exposure", "Software", "Platform", "Accounts", "Other",
)
ALLOWED_SIZES = ("half", "full")
MAX_KEYS = 80          # cap what we ask the model to label in one go
_HEADING_MAX = 40


# ── collect the KEYS (never the values) that the generic renderer would show ──

def _type_hint(v: Any) -> str:
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "text"
    if isinstance(v, list):
        return "list"
    if isinstance(v, dict):
        return "object"
    return "empty"


def _is_section(o: Any) -> bool:
    return isinstance(o, dict) and "status" in o and "data" in o


def collect_field_keys(asset: Any) -> List[Dict[str, str]]:
    """Enumerate the field keys an asset carries, with a source path + type hint.
    Mirrors what the frontend's generic path surfaces: flat platform_properties
    scalars, the flat external_probe dict, and the scalar keys inside each
    section's `data` object. Values are deliberately NOT included."""
    out: List[Dict[str, str]] = []
    seen = set()

    def add(path: str, key: str, v: Any):
        k = f"{path}.{key}" if path else key
        if k in seen or v is None or v == "" or v == []:
            return
        seen.add(k)
        out.append({"key": k, "type": _type_hint(v)})

    pp = getattr(asset, "platform_properties", None) or {}
    for k, v in pp.items():
        if k in ("fingerprint", "discovery_classification"):
            continue
        if k == "external_probe" and isinstance(v, dict):
            for pk, pv in v.items():
                add("external_probe", pk, pv)
            continue
        if _is_section(v):
            data = v.get("data")
            if isinstance(data, dict):
                for dk, dv in data.items():
                    if not isinstance(dv, (dict, list)):
                        add(k, dk, dv)
            continue
        if not isinstance(v, (dict, list)):
            add("", k, v)

    app = getattr(asset, "app_attributes_json", None) or {}
    if isinstance(app, dict):
        for k, v in app.items():
            if not isinstance(v, (dict, list)):
                add("app", k, v)

    return out[:MAX_KEYS]


def keyset_hash(keys: List[Dict[str, str]]) -> str:
    return hashlib.sha256(json.dumps(sorted(k["key"] for k in keys)).encode()).hexdigest()[:16]


# ── the model call ─────────────────────────────────────────────────────────────

_SYSTEM = (
    "You design the layout of an IT-asset detail page for a security/GRC product. "
    "You are given ONLY the raw field KEYS collected from a device (never their values). "
    "For each key return a short, clean, human-readable heading and the card it belongs in. "
    "Headings must be title-cased, expand acronyms properly (IPv4, MAC, DNS, TLS, CPU, OS, BIOS, FQDN), "
    "and be at most 40 characters. Group related keys into the same card. "
    "Return ONLY JSON of the shape "
    "{\"fields\": [{\"key\": str, \"heading\": str, \"card\": str}], "
    "\"cards\": [{\"name\": str, \"size\": \"half\"|\"full\", \"order\": int}]}. "
    "card names MUST be one of: " + ", ".join(ALLOWED_CARDS) + ". "
    "A card with more than 8 fields should be \"full\"; otherwise \"half\". "
    "Every input key must appear exactly once in fields. Do not add keys that were not given."
)


def _call_model(keys: List[Dict[str, str]], kind_hint: str) -> Optional[Dict[str, Any]]:
    try:
        from ..modules.control_library.routers.groups import get_openai_client, check_ai_available
        from ..config import get_openai_model
        if not check_ai_available():
            return None
        client = get_openai_client()
        user = json.dumps({"asset_kind": kind_hint, "keys": keys})
        # Attribute the spend to this feature in the AI-usage ledger (module/feature
        # keys); tenant_slug is supplied by the request middleware when called from
        # the endpoint, or by the caller for background use.
        from .ai_usage import usage_scope
        with usage_scope(module_key="asset_layout", feature_key="overview_plan"):
            resp = client.chat.completions.create(
                model=get_openai_model(),
                temperature=0,
                response_format={"type": "json_object"},
                messages=[{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}],
            )
        text = (resp.choices[0].message.content or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception:  # noqa: BLE001 — any failure means "no plan"; Layer 1 renders
        logger.exception("asset_layout_ai: model call failed (falling back to generic layout)")
        return None


# ── validation: the plan must be SAFE before the UI ever sees it ─────────────

def validate_plan(raw: Any, keys: List[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    """Return a clean plan or None. Rejects (→ fallback) on: a key we did not
    send, a missing key, a card outside the allow-list, an overlong heading."""
    if not isinstance(raw, dict):
        return None
    fields = raw.get("fields")
    cards = raw.get("cards")
    if not isinstance(fields, list) or not isinstance(cards, list):
        return None
    wanted = {k["key"] for k in keys}
    got: Dict[str, Dict[str, str]] = {}
    for f in fields:
        if not isinstance(f, dict):
            return None
        k, h, c = f.get("key"), f.get("heading"), f.get("card")
        if k not in wanted or not isinstance(h, str) or not h.strip() or c not in ALLOWED_CARDS:
            return None
        h = h.strip()
        if len(h) > _HEADING_MAX:
            return None
        got[k] = {"key": k, "heading": h, "card": c}
    if set(got) != wanted:
        return None  # the model dropped or invented a key

    used_cards = {v["card"] for v in got.values()}
    clean_cards: List[Dict[str, Any]] = []
    seen_cards = set()
    for c in cards:
        if not isinstance(c, dict):
            return None
        name, size, order = c.get("name"), c.get("size"), c.get("order")
        if name not in ALLOWED_CARDS or size not in ALLOWED_SIZES or not isinstance(order, int):
            return None
        if name in seen_cards:
            continue
        seen_cards.add(name)
        clean_cards.append({"name": name, "size": size, "order": order})
    # every card a field points at must exist; add any the model forgot (half, last)
    for name in used_cards - seen_cards:
        clean_cards.append({"name": name, "size": "half", "order": 99})
    clean_cards.sort(key=lambda c: c["order"])
    return {"version": PROMPT_VERSION, "fields": list(got.values()), "cards": clean_cards}


# ── public entry point: cached plan or None ───────────────────────────────────

def get_or_build_plan(db: Session, tenant_id: int, asset: Any, *, force: bool = False) -> Optional[Dict[str, Any]]:
    """Return the layout plan for this asset — from cache if the key set is
    unchanged, else freshly planned and cached. Returns None whenever a valid
    plan can't be produced, which the caller treats as 'use the generic layout'."""
    from ..models import AIRecommendation
    keys = collect_field_keys(asset)
    if not keys:
        return None
    khash = keyset_hash(keys)
    entity_id = str(getattr(asset, "id", ""))

    rec = (
        db.query(AIRecommendation)
        .filter(
            AIRecommendation.tenant_id == tenant_id,
            AIRecommendation.module == MODULE,
            AIRecommendation.entity_type == "it_asset",
            AIRecommendation.entity_id == entity_id,
            AIRecommendation.recommendation_type == REC_TYPE,
        )
        .first()
    )
    if rec and not force:
        out = rec.output or {}
        if out.get("keyset_hash") == khash and out.get("plan"):
            return out["plan"]

    kind_hint = getattr(asset, "platform_kind", None) or getattr(asset, "asset_type", None) or "host"
    if getattr(asset, "last_seen_source", None) == "external":
        kind_hint = f"{kind_hint} (internet-facing, discovered externally — no login)"
    raw = _call_model(keys, str(kind_hint))
    plan = validate_plan(raw, keys) if raw is not None else None
    if plan is None:
        return None

    payload = {"keyset_hash": khash, "plan": plan, "key_count": len(keys)}
    try:
        from ..config import get_openai_model
        model_name = get_openai_model()
    except Exception:  # noqa: BLE001
        model_name = None
    if rec:
        rec.output = payload
        rec.model = model_name
        rec.status = "saved"
    else:
        db.add(AIRecommendation(
            tenant_id=tenant_id, module=MODULE, entity_type="it_asset", entity_id=entity_id,
            recommendation_type=REC_TYPE, title="Asset detail layout plan",
            summary=f"{len(keys)} fields across {len(plan['cards'])} cards",
            output=payload, model=model_name, status="saved",
        ))
    try:
        db.commit()
    except Exception:  # noqa: BLE001 — a cache-write failure must not lose the plan
        db.rollback()
        logger.exception("asset_layout_ai: cache write failed (plan still returned)")
    return plan
