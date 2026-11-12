"""Framework onboarding catalog: the shipped JSON (organisation profile + one file per family),
its validator, and the resolver that turns a framework slug into its steps.

The catalog is data, not code (plan D9): ``seed_data/framework_onboarding/*.json``.
Field references are ``step.field`` inside a family and ``org.group.field`` for the profile (a ``when`` or a prefill may read it; nothing requires it).
Nothing here touches a database.
"""
from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

CATALOG_DIR = Path(__file__).resolve().parents[2] / "seed_data" / "framework_onboarding"
REGISTRY_PATH = Path(__file__).resolve().parents[2] / "seed_data" / "scf" / "crosswalk_registry.json"

# One file per family, in the order the register shows them. ``general`` is the fallback.
FAMILY_KEYS = (
    "iso_management", "attestation", "payments", "control_frameworks",
    "privacy_data_protection", "eu_resilience", "gcc_regulators",
    "supplier_certification", "asia_regulators", "general",
)
GENERAL = "general"
COMMON = "common"     # common.json: the steps every framework starts with, before its own (family) questions

FIELD_TYPES = {
    "text", "longtext", "number", "date", "bool", "choice", "multichoice", "person",
    "country", "countries", "table", "asset_refs", "vendor_ref", "org_pick", "departments_derived", "files", "existing",
}
# What a table column may hold (no nested tables or org picks).
CELL_TYPES = {
    "text", "longtext", "number", "date", "bool", "choice", "person",
    "country", "countries", "asset_refs", "vendor_ref",
}
LEVELS = {"required", "advised", "optional"}
CONFIDENCE = {"verified", "secondary", "unverified"}
# org_pick ``of`` -> the profile field the rows are picked from.
ORG_PICK_SOURCE = {
    "entities": "entities_sites.legal_entities",
    "sites": "entities_sites.sites",
    "systems": "data_systems.key_systems",
    "third_parties": "data_systems.third_parties",
    "data_types": "data_systems.data_types",
    "departments": "entities_sites.units",
}
# gate check type -> its parameters (table_rule also needs one of not_equals / then_equals).
CHECK_PARAMS = {
    "filled": ("field",), "true": ("field",),
    "equals": ("field", "value"), "not_equals": ("field", "value"),
    "in": ("field", "values"), "includes": ("field", "value"),
    "count_at_least": ("field", "n"),
    "before": ("first", "second"), "span_at_least_days": ("first", "second", "days"),
    "distinct": ("fields",), "any_filled": ("fields",),
    "table_rule": ("field", "when_column", "equals", "then_column"),
}
WHEN_OPS = ("eq", "ne", "in", "includes", "truthy")   # includes: a multichoice/countries list contains the value
MAX_LABEL_WORDS = 3
MAX_NOTE_CHARS = 320


# --------------------------------------------------------------------------- loading
def _read(name: str) -> Dict[str, Any]:
    with (CATALOG_DIR / f"{name}.json").open(encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def _load() -> Dict[str, Any]:
    fams: Dict[str, Dict[str, Any]] = {}
    for key in FAMILY_KEYS:
        if (CATALOG_DIR / f"{key}.json").is_file():
            fams[key] = _read(key)
    return {"profile": _read("org_profile"), "common": _read(COMMON), "families": fams}


def common() -> Dict[str, Any]:
    return _load()["common"]


def profile() -> Dict[str, Any]:
    return _load()["profile"]


def families() -> Dict[str, Dict[str, Any]]:
    return _load()["families"]


def catalog_version() -> int:
    """One number for the whole shipped catalog; a snapshot records the one an approval used."""
    return max([int(profile().get("version") or 1), int(common().get("version") or 1)] + [int(f.get("version") or 1) for f in families().values()])


def family_key_for_slug(slug: Optional[str]) -> str:
    """The family a framework slug belongs to; unknown, custom and uploaded frameworks get ``general``."""
    for key, fam in families().items():
        for fw in fam.get("frameworks") or []:
            if fw["slug"] == slug:
                return key
    return GENERAL


def framework_entry(slug: Optional[str]) -> Dict[str, Any]:
    fam_key = family_key_for_slug(slug)
    for fw in (families().get(fam_key) or {}).get("frameworks") or []:
        if fw["slug"] == slug:
            return {**fw, "family": fam_key}
    return {"slug": slug, "label": None, "flow_id": None, "family": GENERAL}


# --------------------------------------------------------------------------- indexes
def profile_fields() -> Dict[str, Dict[str, Any]]:
    """``group.field`` -> field (with its group key and effective source)."""
    out: Dict[str, Dict[str, Any]] = {}
    for g in profile()["groups"]:
        for f in g["fields"]:
            out[f"{g.get('key')}.{f.get('key')}"] = {**f, "_group": g.get("key"), "_source": f.get("source") or g.get("source")}
    return out


def family_fields(fam: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """``step.field`` -> field (with its step key and effective source): the common steps and the family's own."""
    out: Dict[str, Dict[str, Any]] = {}
    for s in [*common().get("steps", []), *fam.get("steps", [])]:
        for f in s["fields"]:
            out[f"{s.get('key')}.{f.get('key')}"] = {**f, "_step": s.get("key"), "_source": f.get("source") or s.get("source")}
    return out


def _applies(item: Dict[str, Any], slug: str) -> bool:
    a = item.get("applies_to")
    return not a or slug in a


def resolve(slug: Optional[str]) -> Dict[str, Any]:
    """The catalog for ONE framework: the common steps, then the family's, each narrowed by ``applies_to`` (steps left with
    no field are dropped), each field carrying its effective source, plus the gate checks of both."""
    entry = framework_entry(slug)
    fam = families().get(entry["family"]) or families().get(GENERAL)
    if fam is None:
        return {"slug": slug, "family": GENERAL, "label": entry.get("label"), "steps": [], "gate": [], "requires_org": [],      # no catalog at all
                "existing_types": list(common().get("existing_types_default") or []), "existing_confidence": "secondary"}
    s = slug or ""
    steps: List[Dict[str, Any]] = []
    for st in [*common().get("steps", []), *fam.get("steps", [])]:
        fields = []
        for f in st["fields"]:
            if _applies(f, s):
                g = copy.deepcopy(f)
                g.setdefault("source", st.get("source"))
                fields.append(g)
        if fields:
            steps.append({"key": st["key"], "label": st["label"], "source": st.get("source"), "fields": fields})
    return {
        "slug": slug, "family": entry["family"], "family_label": fam.get("label"), "summary": fam.get("summary"),
        "label": entry.get("label"), "flow_id": entry.get("flow_id"), "not_in_library": bool(entry.get("not_in_library")),
        "version": fam.get("version", 1),
        "requires_org": [],               # kept in the answer, empty: the profile gates nothing (a framework asks its own questions)
        # what a person may list as already existing for THIS framework (certificates, reports, plans): its own kinds, else the general ones
        "existing_types": list(entry.get("existing_types") or common().get("existing_types_default") or []),
        "existing_confidence": entry.get("existing_confidence") or common().get("existing_confidence") or "secondary",
        "steps": steps,
        "gate": [copy.deepcopy(g) for g in [*common().get("gate", []), *fam.get("gate", [])] if _applies(g, s)],
    }


# --------------------------------------------------------------------------- validation
def _words(label: str) -> int:
    return len(str(label).split())


def _check_source(src: Any, where: str, errs: List[str], required: bool) -> None:
    if src is None:
        if required:
            errs.append(f"{where}: no source (own or from its step/group)")
        return
    if not isinstance(src, dict):
        errs.append(f"{where}: source is not an object")
        return
    for k in ("ref", "asked_by"):
        if not str(src.get(k) or "").strip():
            errs.append(f"{where}: source.{k} is empty")
    if src.get("confidence") not in CONFIDENCE:
        errs.append(f"{where}: source.confidence {src.get('confidence')!r} not in {sorted(CONFIDENCE)}")
    for u in src.get("urls") or []:
        if not (isinstance(u, str) and u.startswith("https://")):
            errs.append(f"{where}: source url {u!r} is not an https link")


def _check_field(f: Dict[str, Any], where: str, errs: List[str], *, in_profile: bool, inherited_source: Any,
                 slugs: Optional[Set[str]]) -> None:
    for k in ("key", "label", "type", "level", "note"):
        if not str(f.get(k) or "").strip():
            errs.append(f"{where}: missing {k}")
    t = f.get("type")
    if t not in FIELD_TYPES:
        errs.append(f"{where}: type {t!r} unknown")
        return
    if f.get("level") not in LEVELS:
        errs.append(f"{where}: level {f.get('level')!r} not in {sorted(LEVELS)}")
    if _words(f.get("label", "")) > MAX_LABEL_WORDS:
        errs.append(f"{where}: label {f['label']!r} is over {MAX_LABEL_WORDS} words")
    if len(str(f.get("note") or "")) > MAX_NOTE_CHARS:
        errs.append(f"{where}: note is over {MAX_NOTE_CHARS} characters ({len(f['note'])})")
    _check_source(f.get("source") or inherited_source, where, errs, required=True)
    if f.get("source"):
        _check_source(f["source"], where + " (own source)", errs, required=False)
    if t in ("choice", "multichoice"):
        opts = f.get("options")
        if not opts or not isinstance(opts, list):
            errs.append(f"{where}: {t} without options")
        elif len(set(opts)) != len(opts):
            errs.append(f"{where}: duplicate options")
    elif "options" in f:
        errs.append(f"{where}: options on a {t} field")
    if t == "table":
        cols = f.get("columns") or []
        if not cols:
            errs.append(f"{where}: table without columns")
        seen: Set[str] = set()
        for c in cols:
            cw = f"{where}.{c.get('key')}"
            for k in ("key", "label", "type"):
                if not str(c.get(k) or "").strip():
                    errs.append(f"{cw}: column missing {k}")
            if c.get("key") in seen:
                errs.append(f"{cw}: duplicate column key")
            seen.add(c.get("key"))
            if c.get("type") not in CELL_TYPES:
                errs.append(f"{cw}: column type {c.get('type')!r} not allowed in a table")
            if _words(c.get("label", "")) > MAX_LABEL_WORDS:
                errs.append(f"{cw}: column label {c['label']!r} is over {MAX_LABEL_WORDS} words")
            if c.get("type") == "choice" and not c.get("options"):
                errs.append(f"{cw}: choice column without options")
    elif "columns" in f:
        errs.append(f"{where}: columns on a {t} field")
    if t == "org_pick":
        if f.get("of") not in ORG_PICK_SOURCE:
            errs.append(f"{where}: org_pick of {f.get('of')!r} not in {sorted(ORG_PICK_SOURCE)}")
        if in_profile:
            errs.append(f"{where}: org_pick is for family steps, not the profile")
    elif "of" in f:
        errs.append(f"{where}: 'of' on a {t} field")
    if t == "departments_derived" and not in_profile:
        errs.append(f"{where}: departments_derived belongs to the profile")
    if t == "existing":
        if in_profile or f.get("level") != "advised":
            errs.append(f"{where}: the list of what already exists is advised and belongs to the common steps")
    if t == "files":
        if in_profile:
            errs.append(f"{where}: files are for family steps, not the profile")
        if f.get("level") == "required":
            errs.append(f"{where}: an upload is never required")
        if not f.get("when"):
            errs.append(f"{where}: an upload is asked only after a yes, so it needs a 'when'")
    if "min_rows" in f and t not in ("table", "org_pick", "asset_refs", "countries", "departments_derived"):
        errs.append(f"{where}: min_rows on a {t} field")
    if ("min" in f or "max" in f) and t != "number":
        errs.append(f"{where}: min/max on a {t} field")
    if f.get("applies_to"):
        if in_profile:
            errs.append(f"{where}: applies_to in the profile")
        elif slugs is not None and not set(f["applies_to"]) <= slugs:
            errs.append(f"{where}: applies_to names {sorted(set(f['applies_to']) - slugs)} outside the family")


def _ref(ref: str, fam_idx: Dict[str, Any], org_idx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if ref.startswith("org."):
        return org_idx.get(ref[4:])
    return fam_idx.get(ref)


def _compatible(a: Optional[Iterable[str]], b: Optional[Iterable[str]]) -> bool:
    return not a or not b or bool(set(a) & set(b))


def _check_value(target: Dict[str, Any], value: Any, where: str, errs: List[str]) -> None:
    t = target.get("type")
    if t in ("choice", "multichoice"):
        if value not in (target.get("options") or []):
            errs.append(f"{where}: value {value!r} is not an option of {target.get('key')}")
    elif t == "bool" and not isinstance(value, bool):
        errs.append(f"{where}: {target.get('key')} is a bool; value {value!r}")


def _check_when(when: Any, where: str, fam_idx, org_idx, errs: List[str], applies: Optional[List[str]]) -> None:
    if not isinstance(when, dict) or "field" not in when:
        errs.append(f"{where}: bad 'when'")
        return
    ops = [o for o in WHEN_OPS if o in when]
    if len(ops) != 1:
        errs.append(f"{where}: 'when' needs exactly one of {WHEN_OPS}")
    target = _ref(when["field"], fam_idx, org_idx)
    if target is None:
        errs.append(f"{where}: 'when' points at missing field {when['field']!r}")
        return
    if not when["field"].startswith("org.") and not _compatible(applies, target.get("applies_to")):
        errs.append(f"{where}: 'when' field {when['field']} never applies together with this item")
    for op in ("eq", "ne", "includes"):
        if op in when:
            _check_value(target, when[op], where, errs)
    if "includes" in when and target.get("type") not in ("multichoice", "countries"):
        errs.append(f"{where}: 'includes' needs a multichoice field, {when['field']} is {target.get('type')}")
    if "in" in when:
        for v in when["in"]:
            _check_value(target, v, where, errs)


def _check_existing_types(types: Any, confidence: Any, where: str, errs: List[str], required: bool) -> None:
    if types is None:
        if required:
            errs.append(f"{where}: existing_types is missing")
        return
    if not isinstance(types, list) or not 2 <= len(types) <= 12:
        errs.append(f"{where}: existing_types needs 2 to 12 entries")
        return
    if len(set(types)) != len(types):
        errs.append(f"{where}: existing_types has duplicates")
    for x in types:
        if not isinstance(x, str) or not x.strip() or len(x) > 70:
            errs.append(f"{where}: existing_types entry {x!r} is empty or over 70 characters")
    if confidence is not None and confidence not in CONFIDENCE:
        errs.append(f"{where}: existing_confidence {confidence!r} not in {sorted(CONFIDENCE)}")


def _check_gate(g: Dict[str, Any], where: str, fam_idx, org_idx, errs: List[str], slugs: Set[str]) -> None:
    for k in ("key", "label", "level", "hint", "check"):
        if not g.get(k):
            errs.append(f"{where}: missing {k}")
    if g.get("level") not in ("required", "advised"):
        errs.append(f"{where}: level {g.get('level')!r} must be required or advised")
    if g.get("applies_to") and not set(g["applies_to"]) <= slugs:
        errs.append(f"{where}: applies_to names slugs outside the family")
    if g.get("source"):
        _check_source(g["source"], where, errs, required=False)
    if g.get("when"):
        _check_when(g["when"], where, fam_idx, org_idx, errs, g.get("applies_to"))
    c = g.get("check") or {}
    ctype = c.get("type")
    if ctype not in CHECK_PARAMS:
        errs.append(f"{where}: check type {ctype!r} unknown")
        return
    for p in CHECK_PARAMS[ctype]:
        if p not in c:
            errs.append(f"{where}: check {ctype} lacks {p}")
    refs = list(c.get("fields") or []) + [c[k] for k in ("field", "first", "second") if k in c]
    targets: Dict[str, Dict[str, Any]] = {}
    for r in refs:
        tgt = _ref(r, fam_idx, org_idx)
        if tgt is None:
            errs.append(f"{where}: check points at missing field {r!r}")
            continue
        targets[r] = tgt
        if not r.startswith("org.") and not _compatible(g.get("applies_to"), tgt.get("applies_to")):
            errs.append(f"{where}: field {r} never applies together with this check")
    want = {"true": {"bool"}, "before": {"date"}, "span_at_least_days": {"date"}, "distinct": {"person"},
            "includes": {"multichoice", "countries"},
            "count_at_least": {"table", "org_pick", "asset_refs", "countries", "multichoice", "departments_derived"}}.get(ctype)
    if want:
        for r, tgt in targets.items():
            if tgt.get("type") not in want:
                errs.append(f"{where}: check {ctype} on {r} of type {tgt.get('type')}; wants {sorted(want)}")
    if ctype == "distinct" and len(c.get("fields") or []) < 2:
        errs.append(f"{where}: distinct needs two fields")
    if ctype in ("equals", "not_equals", "includes") and "field" in targets and "value" in c:
        _check_value(targets[c["field"]], c["value"], where, errs)
    if ctype == "in" and "field" in targets:
        for v in c.get("values") or []:
            _check_value(targets[c["field"]], v, where, errs)
    if ctype == "table_rule" and "field" in targets:
        tgt = targets[c["field"]]
        cols = {col["key"]: col for col in tgt.get("columns") or []}
        if tgt.get("type") != "table":
            errs.append(f"{where}: table_rule field {c['field']} is not a table")
        for ck in ("when_column", "then_column"):
            if c.get(ck) not in cols:
                errs.append(f"{where}: table_rule {ck} {c.get(ck)!r} is not a column")
        if sum(1 for k in ("not_equals", "then_equals") if k in c) != 1:
            errs.append(f"{where}: table_rule needs exactly one of not_equals / then_equals")
        for ck, vk in (("when_column", "equals"), ("then_column", "not_equals"), ("then_column", "then_equals")):
            col = cols.get(c.get(ck))
            if col and vk in c and col.get("type") == "choice" and c[vk] not in (col.get("options") or []):
                errs.append(f"{where}: table_rule value {c[vk]!r} is not an option of column {c.get(ck)}")


def _registry_slugs() -> Dict[str, bool]:
    """slug -> emitted (the library's registry; ``emit: false`` entries still count as library)."""
    with REGISTRY_PATH.open(encoding="utf-8") as fh:
        return {f["slug"]: f.get("emit") is not False for f in json.load(fh)["frameworks"]}


def validate(flow_ids: Optional[Set[str]] = None) -> List[str]:
    """Every authoring slip in the shipped catalog, as a list of messages (empty = clean)."""
    from grc.models import Tenant  # late: keeps the module importable without the ORM

    errs: List[str] = []
    prof = profile()
    tenant_cols = {c.name for c in Tenant.__table__.columns}

    # ---- the organisation profile
    if not prof.get("groups"):
        errs.append("org_profile: no groups")
    gkeys: Set[str] = set()
    org_idx = profile_fields()
    for g in prof.get("groups", []):
        gw = f"org.{g.get('key')}"
        if g.get("key") in gkeys:
            errs.append(f"{gw}: duplicate group key")
        gkeys.add(g.get("key"))
        if not g.get("label") or _words(g["label"]) > MAX_LABEL_WORDS + 1:  # "Regulators and obligations"
            errs.append(f"{gw}: group label missing or too long")
        _check_source(g.get("source"), gw, errs, required=True)
        seen: Set[str] = set()
        for f in g.get("fields", []):
            fw = f"{gw}.{f.get('key')}"
            if f.get("key") in seen:
                errs.append(f"{fw}: duplicate field key")
            seen.add(f.get("key"))
            _check_field(f, fw, errs, in_profile=True, inherited_source=g.get("source"), slugs=None)
            if f.get("when"):
                _check_when(f["when"], fw, org_idx, org_idx, errs, None)  # plain group.field refs
            if f.get("maps_to"):
                kind, _, col = f["maps_to"].partition(".")
                if kind != "tenant" or col not in tenant_cols:
                    errs.append(f"{fw}: maps_to {f['maps_to']!r} is not a Tenant column")
    for ref in ORG_PICK_SOURCE.values():
        if ref not in org_idx:
            errs.append(f"org_pick source {ref} is not a profile field")
    for ck in prof.get("checks", []):
        _check_gate(ck, f"org.check.{ck.get('key')}", org_idx, org_idx, errs, set())  # plain group.field refs
    # ---- families
    registry = _registry_slugs()
    placed: Dict[str, str] = {}
    fams = families()
    for key in FAMILY_KEYS:
        if key not in fams:
            errs.append(f"family {key}: file is missing")
    for key, fam in fams.items():
        fw = f"{key}"
        if fam.get("family") != key:
            errs.append(f"{fw}: 'family' says {fam.get('family')!r}")
        if not fam.get("label") or not fam.get("summary"):
            errs.append(f"{fw}: label or summary missing")
        slugs: Set[str] = set()
        for entry in fam.get("frameworks", []):
            s = entry.get("slug")
            if not s or not entry.get("label"):
                errs.append(f"{fw}: framework entry without slug or label")
                continue
            slugs.add(s)
            if s in placed:
                errs.append(f"{fw}: slug {s} is also in {placed[s]}")
            placed[s] = key
            if entry.get("not_in_library") and s in registry:
                errs.append(f"{fw}: {s} is flagged not_in_library but is in the registry")
            if not entry.get("not_in_library") and s not in registry:
                errs.append(f"{fw}: {s} is not in the library registry and not flagged not_in_library")
            _check_existing_types(entry.get("existing_types"), entry.get("existing_confidence"), f"{fw}.{s}", errs, required=False)
            fid = entry.get("flow_id")
            if flow_ids is not None and fid and fid not in flow_ids:
                errs.append(f"{fw}: flow_id {fid!r} of {s} is not in frameworkFlows.ts")
        if not slugs and key != GENERAL:
            errs.append(f"{fw}: no frameworks")
        stepkeys: Set[str] = {s.get("key") for s in common().get("steps", [])}      # a family step may not reuse a common step's key
        for st in fam.get("steps", []):
            sw = f"{fw}.{st.get('key')}"
            if st.get("key") in stepkeys:
                errs.append(f"{sw}: duplicate step key")
            stepkeys.add(st.get("key"))
            if not st.get("label") or _words(st["label"]) > MAX_LABEL_WORDS:
                errs.append(f"{sw}: step label missing or over {MAX_LABEL_WORDS} words")
            _check_source(st.get("source"), sw, errs, required=True)
            fkeys: Set[str] = set()
            if not st.get("fields"):
                errs.append(f"{sw}: no fields")
            for f in st.get("fields", []):
                fw2 = f"{sw}.{f.get('key')}"
                if f.get("key") in fkeys:
                    errs.append(f"{fw2}: duplicate field key")
                fkeys.add(f.get("key"))
                _check_field(f, fw2, errs, in_profile=False, inherited_source=st.get("source"), slugs=slugs)
        fam_idx = family_fields(fam)
        for st in fam.get("steps", []):
            for f in st.get("fields", []):
                loc = f"{fw}.{st.get('key')}.{f.get('key')}"
                if f.get("when"):
                    _check_when(f["when"], loc, fam_idx, org_idx, errs, f.get("applies_to"))
                if f.get("prefill_from"):
                    tgt = _ref(f["prefill_from"], fam_idx, org_idx)
                    if tgt is None:
                        errs.append(f"{loc}: prefill_from {f['prefill_from']!r} not found")
                    elif tgt.get("type") != f.get("type"):
                        errs.append(f"{loc}: prefill_from type {tgt.get('type')} differs from {f.get('type')}")
        gkeys2: Set[str] = set()
        for g in fam.get("gate", []):
            if g.get("key") in gkeys2:
                errs.append(f"{fw}.gate.{g.get('key')}: duplicate gate key")
            gkeys2.add(g.get("key"))
            _check_gate(g, f"{fw}.gate.{g.get('key')}", fam_idx, org_idx, errs, slugs)
    # ---- the common steps: asked of every framework
    com = common()
    _check_existing_types(com.get("existing_types_default"), com.get("existing_confidence"), "common", errs, required=True)
    all_slugs = set(placed)
    com_idx = family_fields({"steps": []})
    cstep: Set[str] = set()
    for st in com.get("steps", []):
        sw = f"common.{st.get('key')}"
        if st.get("key") in cstep:
            errs.append(f"{sw}: duplicate step key")
        cstep.add(st.get("key"))
        if not st.get("label") or _words(st["label"]) > MAX_LABEL_WORDS:
            errs.append(f"{sw}: step label missing or over {MAX_LABEL_WORDS} words")
        _check_source(st.get("source"), sw, errs, required=True)
        if not st.get("fields"):
            errs.append(f"{sw}: no fields")
        fkeys = set()
        for f in st.get("fields", []):
            fw2 = f"{sw}.{f.get('key')}"
            if f.get("key") in fkeys:
                errs.append(f"{fw2}: duplicate field key")
            fkeys.add(f.get("key"))
            _check_field(f, fw2, errs, in_profile=False, inherited_source=st.get("source"), slugs=all_slugs)
            if f.get("when"):
                _check_when(f["when"], fw2, com_idx, org_idx, errs, f.get("applies_to"))
            if f.get("prefill_from"):
                tgt = _ref(f["prefill_from"], com_idx, org_idx)
                if tgt is None:
                    errs.append(f"{fw2}: prefill_from {f['prefill_from']!r} not found")
                elif tgt.get("type") != f.get("type"):
                    errs.append(f"{fw2}: prefill_from type {tgt.get('type')} differs from {f.get('type')}")
    gk: Set[str] = set()
    for g in com.get("gate", []):
        if g.get("key") in gk:
            errs.append(f"common.gate.{g.get('key')}: duplicate gate key")
        gk.add(g.get("key"))
        _check_gate(g, f"common.gate.{g.get('key')}", com_idx, org_idx, errs, all_slugs)
    # ---- every library framework sits in exactly one family
    for s in registry:
        if s not in placed:
            errs.append(f"library framework {s} is in no family (it would fall back to general)")
    return errs


def stats() -> Dict[str, Any]:
    out: Dict[str, Any] = {"profile": {"groups": len(profile()["groups"]), "fields": len(profile_fields()),
                                       "checks": len(profile().get("checks") or [])},
                           "common": {"steps": len(common().get("steps") or []), "fields": sum(len(s["fields"]) for s in common().get("steps") or []),
                                      "gate": len(common().get("gate") or [])}, "families": {}}
    for key, fam in families().items():
        out["families"][key] = {
            "frameworks": len(fam.get("frameworks") or []), "steps": len(fam.get("steps") or []),
            "fields": sum(len(s["fields"]) for s in fam.get("steps") or []), "gate": len(fam.get("gate") or []),
        }
    return out
