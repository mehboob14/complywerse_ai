"""The organisation profile: one per tenant, asked once, reused by every framework's onboarding (plan sections 4 and 7).

Values live in ``grc_fw_org_profile.values`` as {group: {field: value}}; the five facts the Tenant row already holds (legal entity,
industry, size, geography, regulatory scope) are read from and written through to the Tenant, so there is one source of truth.
Units are derived from the department tree. Table rows carry stable ids, which a framework scope picks."""
from __future__ import annotations

import copy
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from ...models import (FrameworkOnboarding, FrameworkOrgProfile, GRCDepartment, GRCUser, ITAsset, Tenant, Vendor)
from . import catalog, engine


class ProfileError(Exception):
    def __init__(self, errors: List[Dict[str, str]], status: int = 422, **more: Any):
        super().__init__("profile not saved")
        self.errors, self.status, self.more = errors, status, more


def _row(db: Session, tenant_id: int) -> Optional[FrameworkOrgProfile]:
    return db.query(FrameworkOrgProfile).filter(FrameworkOrgProfile.tenant_id == tenant_id).first()


def departments(db: Session, tenant_id: int) -> List[GRCDepartment]:
    return (db.query(GRCDepartment).filter(GRCDepartment.tenant_id == tenant_id, GRCDepartment.is_active.is_(True))
            .order_by(GRCDepartment.parent_department_id.is_(None).desc(), GRCDepartment.name, GRCDepartment.id).all())


def known(db: Session, tenant_id: int, values: Optional[Dict[str, Any]] = None) -> engine.Known:
    from ...routers.auth_router import platform_account
    users = {i for (i,) in db.query(GRCUser.id).filter(GRCUser.is_active.is_(True), platform_account())}
    assets = {i for (i,) in db.query(ITAsset.id).filter(ITAsset.tenant_id == tenant_id)}
    vendors = {i for (i,) in db.query(Vendor.id).filter(Vendor.tenant_id == tenant_id)}
    depts = {d.id for d in departments(db, tenant_id)}
    rows: Dict[str, Set[str]] = {}
    for of, ref in catalog.ORG_PICK_SOURCE.items():
        if of in ("systems", "departments"):
            continue
        g, f = ref.split(".")
        rows[of] = {r["id"] for r in ((values or {}).get(g) or {}).get(f) or [] if isinstance(r, dict) and r.get("id")}
    return engine.Known(users=users, assets=assets, vendors=vendors, departments=depts, row_ids=rows)


def merged_values(db: Session, tenant_id: int, row: Optional[FrameworkOrgProfile] = None) -> Dict[str, Any]:
    """What the profile holds now: the stored values, the Tenant facts and the derived departments."""
    row = row if row is not None else _row(db, tenant_id)
    values: Dict[str, Any] = copy.deepcopy((row.values if row else None) or {})
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    for g in catalog.profile()["groups"]:
        bucket = values.setdefault(g["key"], {})
        for f in g["fields"]:
            if f.get("maps_to") and tenant is not None:
                v = getattr(tenant, f["maps_to"].split(".", 1)[1], None)
                if v not in (None, ""):
                    bucket[f["key"]] = v
                else:
                    bucket.pop(f["key"], None)
            if f["type"] == "departments_derived":
                bucket[f["key"]] = [d.id for d in departments(db, tenant_id)]
    return values


def refs_for(db: Session, tenant_id: int, *value_sets: Dict[str, Any]) -> Dict[str, Any]:
    """Names for every person, asset, vendor and department the given values point at (the screen shows names, never ids)."""
    users: Set[int] = set()
    assets: Set[int] = set()
    vendors: Set[int] = set()
    depts: Set[int] = set()

    def walk(f: Dict[str, Any], v: Any) -> None:
        t = f.get("type")
        if t == "person" and isinstance(v, dict) and v.get("user_id"):
            users.add(int(v["user_id"]))
        elif t == "asset_refs":
            assets.update(int(i) for i in v or [])
        elif t == "vendor_ref" and v:
            vendors.add(int(v))
        elif t == "org_pick" and f.get("of") == "systems":
            assets.update(int(i) for i in v or [])
        elif t in ("org_pick", "departments_derived") and f.get("of", "departments") == "departments":
            depts.update(int(i) for i in v or [])
        elif t == "table":
            for r in v or []:
                for c in f.get("columns") or []:
                    walk(c, r.get(c["key"]))

    org = catalog.profile_fields()
    for vs in value_sets:
        for key, f in org.items():
            g, k = key.split(".")
            if vs.get(g) and k in vs[g]:
                walk(f, vs[g][k])
    return _names(db, tenant_id, users, assets, vendors, depts)


def _names(db: Session, tenant_id: int, users: Set[int], assets: Set[int], vendors: Set[int], depts: Set[int]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"users": {}, "assets": {}, "vendors": {}, "departments": {}}
    if users:
        for i, display, username in db.query(GRCUser.id, GRCUser.display_name, GRCUser.username).filter(GRCUser.id.in_(users)):
            out["users"][i] = display or username
    if assets:
        for a in db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id, ITAsset.id.in_(assets)):
            out["assets"][a.id] = {"name": a.name, "asset_type": a.asset_type, "criticality": a.criticality}
    if vendors:
        for v in db.query(Vendor).filter(Vendor.tenant_id == tenant_id, Vendor.id.in_(vendors)):
            out["vendors"][v.id] = v.name
    if depts:
        for d in db.query(GRCDepartment).filter(GRCDepartment.tenant_id == tenant_id, GRCDepartment.id.in_(depts)):
            out["departments"][d.id] = d.name
    return out


def view(db: Session, tenant_id: int) -> Dict[str, Any]:
    """GET /org-profile: values, completeness per group, the cross-field checks, names for the references. Never writes."""
    row = _row(db, tenant_id)
    values = merged_values(db, tenant_id, row)
    ev = engine.evaluate_org(values, (row.groups_reviewed if row else None) or {})
    return {
        "values": values, "evaluation": ev, "refs": refs_for(db, tenant_id, values),
        "departments": [{"id": d.id, "name": d.name, "parent_id": d.parent_department_id} for d in departments(db, tenant_id)],
        "catalog_version": catalog.profile().get("version", 1),
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


def _used_by(db: Session, tenant_id: int, removed: Dict[str, Set[str]]) -> List[str]:
    """Onboardings (ready or complete) that picked a row the person is removing: the names of their frameworks."""
    names: List[str] = []
    if not any(removed.values()):
        return names
    for ob in db.query(FrameworkOnboarding).filter(FrameworkOnboarding.tenant_id == tenant_id,
                                                  FrameworkOnboarding.state.in_(["ready", "complete"])).all():
        res = catalog.resolve(ob.framework_slug)
        hit = False
        for st in res["steps"]:
            for f in st["fields"]:
                if f["type"] == "org_pick" and f.get("of") in removed:
                    picked = set((ob.answers or {}).get(st["key"], {}).get(f["key"]) or [])
                    hit = hit or bool(picked & removed[f["of"]])
        if hit:
            names.append(res.get("label") or ob.framework_slug or "A framework")
    return sorted(set(names))


def save(db: Session, tenant_id: int, user: GRCUser, changes: Dict[str, Any]) -> Dict[str, Any]:
    """PUT /org-profile {"group.field": value}: each key replaces that field whole. Nothing is saved when any key is refused."""
    org = catalog.profile_fields()
    row = _row(db, tenant_id)
    values = merged_values(db, tenant_id, row)
    kn = known(db, tenant_id, values)
    errors: List[Dict[str, str]] = []
    clean: Dict[str, Any] = {}
    for key, raw in (changes or {}).items():
        f = org.get(key)
        if f is None:
            errors.append({"field": key, "message": "Unknown field."})
            continue
        if f["type"] == "departments_derived":
            errors.append({"field": key, "message": "Departments are managed in Governance settings."})
            continue
        try:
            clean[key] = engine.normalise(f, raw, kn)
        except engine.FieldError as e:
            errors.append({"field": key, "message": str(e)})
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    for key, v in clean.items():
        f = org[key]
        if f.get("maps_to") and v is not None and tenant is not None:
            col = getattr(Tenant, f["maps_to"].split(".", 1)[1])
            limit = getattr(col.type, "length", None)
            if limit and len(str(v)) > limit:
                errors.append({"field": key, "message": f"Keep it to {limit} characters."})
    if errors:
        raise ProfileError(errors)
    # rows removed from a list that a ready or complete onboarding picked from
    removed: Dict[str, Set[str]] = {}
    for of, ref in catalog.ORG_PICK_SOURCE.items():
        if ref in clean and of not in ("systems", "departments"):
            g, f_ = ref.split(".")
            before = {r["id"] for r in (values.get(g) or {}).get(f_) or []}
            after = {r["id"] for r in clean[ref] or []}
            removed[of] = before - after
    used = _used_by(db, tenant_id, removed)
    if used:
        raise ProfileError([{"field": "rows", "message": "A completed onboarding uses a row you removed."}], 409, used_by=used)

    now = datetime.utcnow()
    if row is None:
        row = FrameworkOrgProfile(tenant_id=tenant_id, values={}, groups_reviewed={}, created_at=now)
        db.add(row)
    stored = copy.deepcopy(row.values or {})
    for key, v in clean.items():
        g, k = key.split(".")
        f = org[key]
        if f.get("maps_to"):
            if tenant is not None:
                setattr(tenant, f["maps_to"].split(".", 1)[1], v)
            stored.get(g, {}).pop(k, None)
            continue
        bucket = stored.setdefault(g, {})
        if v is None or v == []:
            bucket.pop(k, None)
        else:
            bucket[k] = v
    row.values = stored
    row.catalog_version = catalog.profile().get("version", 1)
    row.updated_by, row.updated_at = user.id, now
    reviewed = dict(row.groups_reviewed or {})
    for g in {k.split(".")[0] for k in clean}:      # a stage edited after its review needs another look
        reviewed.pop(g, None)
    row.groups_reviewed = reviewed
    db.commit()
    return view(db, tenant_id)


def review_group(db: Session, tenant_id: int, user: GRCUser, group: str) -> Dict[str, Any]:
    if group not in {g["key"] for g in catalog.profile()["groups"]}:
        raise ProfileError([{"field": group, "message": "Unknown stage."}], 404)
    row = _row(db, tenant_id)
    if row is None:
        row = FrameworkOrgProfile(tenant_id=tenant_id, values={}, groups_reviewed={}, created_at=datetime.utcnow())
        db.add(row)
    reviewed = dict(row.groups_reviewed or {})
    reviewed[group] = {"at": datetime.utcnow().isoformat(), "by": user.id}
    row.groups_reviewed = reviewed
    row.updated_by, row.updated_at = user.id, datetime.utcnow()
    db.commit()
    return view(db, tenant_id)


def catalog_view() -> Dict[str, Any]:
    """The static, versioned description of the profile (groups, fields, notes, sources): GET /org-profile/catalog."""
    p = catalog.profile()
    return {"version": p.get("version", 1), "label": p.get("label"), "summary": p.get("summary"), "groups": p["groups"],
            "checks": p.get("checks") or [], "org_pick_source": catalog.ORG_PICK_SOURCE}
