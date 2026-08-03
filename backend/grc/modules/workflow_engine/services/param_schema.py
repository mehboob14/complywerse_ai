"""Per-node parameter schemas for the workflow builder config panel.

Each auto-generated platform-function node corresponds to a real FastAPI
endpoint. This module matches a node back to its live route (by the route
identity stored on the node — module / router / function / method) and reads
that route's **OpenAPI** operation to produce a clean, typed list of the
fields the node accepts: path identifiers (which risk / control / document),
query params, and request-body fields, with enum choices resolved and object
references tagged with an entity type so the UI can render a record picker.

The whole thing is best-effort and cached: if a node can't be matched or a
schema can't be resolved, it simply yields fewer fields — the config panel
falls back gracefully. Nothing here affects execution.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Body / path fields that are plumbing, not user-facing config.
_SKIP_FIELDS = {
    "tenant_id", "created_at", "updated_at", "created_by", "updated_by",
    "created_by_id", "updated_by_id", "id", "deleted_at", "is_deleted",
    # Reserved builder/config keys — a node-config field with one of these
    # names would clash with the canvas node's own state (renaming the node,
    # changing its type, etc.), so we never surface them as inputs.
    "label", "module", "submodule", "action_name", "trigger_type",
    "condition_kind", "approval_type", "timer_kind", "payload",
}

# Header / cookie params we never surface.
_SKIP_PARAM_LOCATIONS = {"header", "cookie"}

# Map a field name to a platform entity type so the UI can show a record
# picker (search real records) instead of a raw id box. Order matters — more
# specific suffixes first.
_ENTITY_BY_SUFFIX: List[tuple[str, str]] = [
    ("framework_id", "framework"),
    ("document_id", "document"),
    ("evidence_id", "evidence"),
    ("control_id", "control"),
    ("risk_id", "risk"),
    ("policy_id", "document"),
    ("vulnerability_id", "vulnerability"),
    ("assessment_id", "assessment"),
    ("owner_user_id", "user"),
    ("assignee_id", "user"),
    ("assigned_to_id", "user"),
    ("reviewer_id", "user"),
    ("approver_id", "user"),
    ("user_id", "user"),
    ("owner_id", "user"),
]


def _entity_for_field(name: str) -> Optional[str]:
    lname = (name or "").lower()
    for suffix, entity in _ENTITY_BY_SUFFIX:
        if lname == suffix or lname.endswith("_" + suffix) or lname.endswith(suffix):
            return entity
    return None


def _humanize(name: str) -> str:
    cleaned = re.sub(r"_id$", "", name or "")
    cleaned = cleaned.replace("_", " ").strip()
    if not cleaned:
        cleaned = name
    return cleaned[:1].upper() + cleaned[1:] if cleaned else name


def _unwrap_schema(schema: Dict[str, Any], components: Dict[str, Any], depth: int = 0) -> Dict[str, Any]:
    """Resolve $ref / anyOf / oneOf / allOf down to a concrete schema dict
    carrying at least ``type`` and (when present) ``enum`` / ``format``."""
    if not isinstance(schema, dict) or depth > 6:
        return {}
    if "$ref" in schema:
        name = str(schema["$ref"]).split("/")[-1]
        return _unwrap_schema(components.get(name, {}), components, depth + 1)
    # Optional fields render as anyOf:[{...}, {type: null}] — take the
    # first meaningful (non-null) branch.
    for combinator in ("anyOf", "oneOf", "allOf"):
        if combinator in schema and isinstance(schema[combinator], list):
            for branch in schema[combinator]:
                if isinstance(branch, dict) and branch.get("type") == "null":
                    continue
                resolved = _unwrap_schema(branch, components, depth + 1)
                if resolved:
                    # Carry over an inline enum/format declared alongside allOf.
                    for k in ("enum", "format"):
                        if k in schema and k not in resolved:
                            resolved[k] = schema[k]
                    return resolved
    return schema


def _field_from_schema(name: str, schema: Dict[str, Any], location: str,
                       required: bool, components: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    resolved = _unwrap_schema(schema, components)
    ftype = resolved.get("type") or "string"
    if isinstance(ftype, list):  # e.g. ["string","null"]
        ftype = next((t for t in ftype if t != "null"), "string")
    field: Dict[str, Any] = {
        "name": name,
        "label": _humanize(name),
        "location": location,
        "type": ftype,
        "required": bool(required),
    }
    enum = resolved.get("enum")
    if isinstance(enum, list) and enum:
        field["enum"] = [str(e) for e in enum if e is not None]
    fmt = resolved.get("format")
    if fmt:
        field["format"] = fmt
    entity = _entity_for_field(name)
    if entity:
        field["entity"] = entity
    return field


def _fields_from_operation(op: Dict[str, Any], components: Dict[str, Any], max_fields: int = 30) -> List[Dict[str, Any]]:
    fields: List[Dict[str, Any]] = []
    seen: set[str] = set()

    def _add(f: Optional[Dict[str, Any]]) -> None:
        if not f:
            return
        nm = f["name"]
        if nm in seen or nm in _SKIP_FIELDS:
            return
        seen.add(nm)
        fields.append(f)

    # Path + query parameters
    for p in op.get("parameters", []) or []:
        if not isinstance(p, dict):
            continue
        loc = p.get("in")
        if loc in _SKIP_PARAM_LOCATIONS or loc not in ("path", "query"):
            continue
        _add(_field_from_schema(p.get("name", ""), p.get("schema", {}) or {},
                                loc, bool(p.get("required")), components))

    # Request body fields
    rb = op.get("requestBody")
    if isinstance(rb, dict):
        content = rb.get("content", {}) or {}
        media = content.get("application/json") or next(iter(content.values()), {})
        body_schema = _unwrap_schema((media or {}).get("schema", {}) or {}, components)
        props = body_schema.get("properties")
        if isinstance(props, dict):
            req = set(body_schema.get("required", []) or [])
            for fname, fschema in props.items():
                _add(_field_from_schema(fname, fschema, "body", fname in req, components))
        elif body_schema.get("type"):
            # Scalar body (rare) — expose as a single "value" field.
            _add({"name": "value", "label": "Value", "location": "body",
                  "type": body_schema.get("type", "string"), "required": bool(rb.get("required"))})

    # Required first, then keep declaration order; cap to keep panels sane.
    fields.sort(key=lambda f: (not f["required"],))
    return fields[:max_fields]


def _route_identity(route: Any) -> Optional[tuple[str, str, str, str]]:
    """(module_dir, router_stem, fn_name, method) for a grc.modules.* route."""
    ep = getattr(route, "endpoint", None)
    if ep is None:
        return None
    mod = getattr(ep, "__module__", "") or ""
    m = re.match(r"grc\.modules\.([^.]+)\.routers\.([^.]+)$", mod)
    if not m:
        return None
    methods = getattr(route, "methods", None) or set()
    method = next((x.lower() for x in methods if x.upper() in
                   {"GET", "POST", "PUT", "PATCH", "DELETE"}), None)
    if not method:
        return None
    return (m.group(1), m.group(2), getattr(ep, "__name__", ""), method)


_CACHE: Optional[Dict[str, List[Dict[str, Any]]]] = None


def build_node_param_schemas(app: Any) -> Dict[str, List[Dict[str, Any]]]:
    """Return ``{platform_action_key: [field, ...]}`` for every node we can
    match to a live route. Cached after the first build."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE

    from .catalog import PLATFORM_FUNCTION_NODE_TYPES
    from fastapi.routing import APIRoute

    # Index live routes by identity, and capture the full mounted path.
    route_index: Dict[tuple[str, str, str, str], Any] = {}
    for route in getattr(app, "routes", []):
        if not isinstance(route, APIRoute):
            continue
        ident = _route_identity(route)
        if ident:
            route_index.setdefault(ident, route)

    try:
        openapi = app.openapi()
    except Exception:  # noqa: BLE001
        logger.exception("workflow param-schema: app.openapi() failed")
        _CACHE = {}
        return _CACHE
    paths = openapi.get("paths", {})
    components = openapi.get("components", {}).get("schemas", {})

    result: Dict[str, List[Dict[str, Any]]] = {}
    for node in PLATFORM_FUNCTION_NODE_TYPES:
        ident = (
            str(node.get("module_dir") or ""),
            str(node.get("router_stem") or ""),
            str(node.get("fn_name") or ""),
            str(node.get("method") or ""),
        )
        route = route_index.get(ident)
        if route is None:
            continue
        op = (paths.get(route.path, {}) or {}).get(ident[3], {})
        if not op:
            continue
        try:
            fields = _fields_from_operation(op, components)
        except Exception:  # noqa: BLE001
            logger.debug("param-schema extraction failed for %s", node.get("key"))
            continue
        if fields:
            result[node["key"]] = fields

    _CACHE = result
    return result
