"""FAIR analyses: one loss scenario at one supplier, taken apart factor by factor.

The taxonomy is FAIR's. How often a threat acts against the asset (threat event
frequency) times the chance an attempt becomes a loss (vulnerability) is how
often a loss happens (loss event frequency). Each loss costs its primary forms
— response, lost productivity, replacement — and, when regulators, customers or
competitors react (the secondary loss event frequency), the secondary forms:
fines and judgments, reputation, competitive advantage.

Every factor is a range (least, most likely, most) drawn as a PERT distribution.
Thousands of simulated years give the annualized loss exposure: the chance of a
loss this year, the average year, the bad years, and the loss exceedance curve —
for each amount, the chance the year costs at least that much. The one-in-twenty
year is offered as the least liability cap to accept in the contract.

A new analysis is prefilled from what the programme holds about the supplier —
its tier, the data it reaches, the continuity processes behind it, its residual
rating and its outside-in grade — through the tenant's exposure settings, and
every prefilled number says where it came from. They are starting values for
the analyst, not answers. Analyses go out and come in as CSV.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAFairAnalysis, TPRASurfaceScan, Vendor, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from . import quantification as q, rbac, service

router = APIRouter(tags=["Vendor comply analyses"])

EFFECTS = ("confidentiality", "integrity", "availability")
PRIMARY = {"response": "Response", "productivity": "Productivity", "replacement": "Replacement"}
SECONDARY = {"fines": "Fines and judgments", "reputation": "Reputation", "competitive": "Competitive advantage"}
MAX_EVENTS = 365           # a year holds at most one loss event a day
MAX_MONEY = 1e12
ITERATIONS = (1000, 50000)
LEC_POINTS = 30
# Starting values for the chance an attempt becomes a loss, by outside-in grade.
VULN_BY_GRADE = {"A": [0.01, 0.03, 0.08], "B": [0.02, 0.06, 0.15], "C": [0.04, 0.1, 0.25],
                 "D": [0.08, 0.18, 0.4], "F": [0.15, 0.3, 0.6]}
GRADE_FOR_RATING = {"low": "B", "medium": "C", "high": "D", "critical": "F", "unrated": "C"}
SENSITIVE = ("confidential", "restricted", "regulated")


# ── inputs ───────────────────────────────────────────────────────────────────

def _triple(value, name: str, high: float) -> List[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{name} needs a least, most likely and most value")
    try:
        lo, mode, hi = (float(x) for x in value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be numbers")
    if any(math.isnan(x) for x in (lo, mode, hi)) or not 0 <= lo <= mode <= hi <= high:
        raise ValueError(f"{name} must run least ≤ most likely ≤ most, between 0 and {high:,g}")
    return [lo, mode, hi]


def clean(raw: dict) -> dict:
    """Validated inputs; a missing loss form costs nothing."""
    if not isinstance(raw, dict):
        raise ValueError("The inputs must be an object")
    primary, secondary = raw.get("primary") or {}, raw.get("secondary") or {}
    out = {
        "tef": _triple(raw.get("tef"), "Threat event frequency", MAX_EVENTS),
        "vulnerability": _triple(raw.get("vulnerability"), "Vulnerability", 1),
        "primary": {k: _triple(primary.get(k, [0, 0, 0]), label, MAX_MONEY) for k, label in PRIMARY.items()},
        "secondary": {"probability": _triple(secondary.get("probability", [0, 0, 0]), "Secondary loss event frequency", 1),
                      **{k: _triple(secondary.get(k, [0, 0, 0]), label, MAX_MONEY) for k, label in SECONDARY.items()}},
        "iterations": int(raw.get("iterations") or 10000),
    }
    if not ITERATIONS[0] <= out["iterations"] <= ITERATIONS[1]:
        raise ValueError(f"Iterations must be between {ITERATIONS[0]:,} and {ITERATIONS[1]:,}")
    return out


# ── the simulation ───────────────────────────────────────────────────────────

def _round_up(x: float) -> int:
    """Up to two significant figures, the way a liability cap is written."""
    if x <= 0:
        return 0
    step = 10 ** max(0, int(math.floor(math.log10(x))) - 1)
    return int(math.ceil(x / step) * step)


def simulate(inputs: dict, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    n = inputs["iterations"]
    tef = q._pert(rng, inputs["tef"], n)
    vuln = q._pert(rng, inputs["vulnerability"], n)
    lef = tef * vuln
    events = np.minimum(q._poisson(rng.random(n), lef), MAX_EVENTS).astype(int)
    total = int(events.sum())
    primary = sum((q._pert(rng, t, total) for t in inputs["primary"].values()), np.zeros(total))
    happens = rng.random(total) < q._pert(rng, inputs["secondary"]["probability"], total)
    secondary = sum((q._pert(rng, inputs["secondary"][k], total) for k in SECONDARY), np.zeros(total)) * happens
    years = np.repeat(np.arange(n), events)
    annual_primary = np.bincount(years, weights=primary, minlength=n)
    annual = annual_primary + np.bincount(years, weights=secondary, minlength=n)
    per_event = primary + secondary
    pct = lambda x, p: round(float(np.percentile(x, p))) if len(x) else 0
    lec = []
    losses = annual[annual > 0]
    if len(losses):
        lo, hi = max(1.0, float(np.percentile(losses, 1))), float(losses.max())
        for x in np.geomspace(lo, max(hi, lo * 1.0001), LEC_POINTS):
            lec.append({"loss": round(float(x)), "chance": round(float((annual >= x).mean()), 4)})
    p95 = pct(annual, 95)
    return {
        "iterations": n,
        "lef": {"mean": round(float(lef.mean()), 4), "p10": round(float(np.percentile(lef, 10)), 4),
                "p90": round(float(np.percentile(lef, 90)), 4)},
        "annual": {"chance": round(float((annual > 0).mean()), 4), "mean": round(float(annual.mean())),
                   "p50": pct(annual, 50), "p90": pct(annual, 90), "p95": p95, "p99": pct(annual, 99),
                   "max": round(float(annual.max()))},
        "per_event": {"p10": pct(per_event, 10), "p50": pct(per_event, 50), "p90": pct(per_event, 90)},
        "split": {"primary": round(float(annual_primary.mean())), "secondary": round(float(annual.mean() - annual_primary.mean())),
                  "secondary_share": round(float(happens.mean()), 4) if total else 0.0},
        "lec": lec, "liability_cap": _round_up(p95),
    }


def _seed(vendor_id: int, inputs: dict) -> int:
    return int(hashlib.sha256(json.dumps([vendor_id, inputs], sort_keys=True).encode()).hexdigest()[:12], 16)


# ── prefill from what we hold ────────────────────────────────────────────────

def _scale(t: List[float], by: float, ndigits: int = 4) -> List[float]:
    return [round(x * by, ndigits) for x in t]


def _times(a: List[float], b: List[float]) -> List[float]:
    return [round(x * y) for x, y in zip(a, b)]


def prefill(db: Session, vendor: Vendor, effect: str = "confidentiality") -> Tuple[dict, List[str]]:
    """Starting inputs for one supplier and scenario, and where each came from."""
    from .reports import functions

    cfg = q._config(db, vendor.tenant_id)
    processes = [f for f in functions(db, vendor.tenant_id, date.today(), [vendor]) if f.get("vendor_id") == vendor.id]
    p = q.profile(vendor, processes)
    scan = (db.query(TPRASurfaceScan).filter(TPRASurfaceScan.vendor_id == vendor.id, TPRASurfaceScan.status == "done",
                                             TPRASurfaceScan.grade.isnot(None))
            .order_by(TPRASurfaceScan.started_at.desc()).first())
    notes: List[str] = []
    if effect == "availability":
        vuln = [0.5, 0.8, 1.0]
        rate = cfg["outage_per_year"][p["tier"]]
        notes.append("Vulnerability: most disruptions at a supplier stop the service we use (starting value).")
    else:
        grade = scan.grade if scan is not None else GRADE_FOR_RATING[p["rating"]]
        vuln = VULN_BY_GRADE[grade]
        notes.append(f"Vulnerability from the outside-in grade {grade}, scanned {scan.finished_at or scan.started_at:%d %b %Y}."
                     if scan is not None else f"Vulnerability from the residual rating ({p['rating']}); no outside-in grade yet.")
        rate = cfg["breach_per_year"][p["tier"]]
    tef = [min(MAX_EVENTS, x) for x in _scale(rate, 1 / vuln[1], 3)]
    notes.append(f"Threat event frequency set so that, with that vulnerability, loss events match the "
                 f"{p['tier']} tier's rate in the exposure settings ({rate[1]:g} a year, most likely).")
    records = cfg["records"][p["access"]]
    hours, per_hour = cfg["outage_hours"], cfg["outage_cost_per_hour"][p["outage_band"]]
    if effect == "availability":
        primary = {"response": _scale(cfg["response_cost"], 0.2, 0), "productivity": _times(hours, per_hour),
                   "replacement": [0, 0, 0]}
        notes.append(f"Productivity: {hours[1]:g} hours down at {per_hour[1]:,.0f} an hour, most likely"
                     + (f", for {p['process']} ({p['outage_band']})." if p["process"] else f"; no continuity process recorded, "
                                                                                     f"so the {p['tier']} tier stands in."))
        secondary = {"probability": [0.01, 0.05, 0.15], "fines": [0, 0, 0], "reputation": [0, 10000, 100000],
                     "competitive": [0, 0, 50000]}
    else:
        primary = {"response": cfg["response_cost"], "productivity": [0, 0, 0],
                   "replacement": _times(records, cfg["cost_per_record"])}
        notes.append(f"Replacement: {records[1]:,.0f} records exposed, most likely, for data access "
                     f"'{p['access']}', at the settings' cost per record.")
        sensitive = p["access"] in SENSITIVE
        secondary = {"probability": [0.2, 0.4, 0.7] if sensitive else [0.05, 0.15, 0.3],
                     "fines": [10000, 100000, 1000000] if sensitive else [0, 10000, 100000],
                     "reputation": [0, 50000, 500000], "competitive": [0, 0, 100000]}
        notes.append("Secondary losses: starting values for " + ("sensitive data; regulators and customers are likely to react."
                                                                 if sensitive else "data that is not sensitive."))
    notes.append("Every value is a starting point from this organisation's settings, not a benchmark: adjust it.")
    return clean({"tef": tef, "vulnerability": vuln, "primary": primary, "secondary": secondary, "iterations": 10000}), notes


# ── CSV in and out ───────────────────────────────────────────────────────────

FACTOR_COLUMNS = [("tef", None), ("vulnerability", None), *[("primary", k) for k in PRIMARY],
                  ("secondary", "probability"), *[("secondary", k) for k in SECONDARY]]
CSV_COLUMNS = ["vendor", "name", "effect", "scenario", "asset", "threat"] + [
    f"{(sub or top)}_{end}" for top, sub in FACTOR_COLUMNS for end in ("least", "likely", "most")]


def _factor(inputs: dict, top: str, sub: Optional[str]) -> List[float]:
    return inputs[top] if sub is None else inputs[top][sub]


def export_rows(analyses: List[Tuple[TPRAFairAnalysis, Vendor]]) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(CSV_COLUMNS + ["chance_of_loss", "average_year", "one_year_in_ten", "one_year_in_twenty", "liability_cap"])
    for a, v in analyses:
        r = (a.result or {}).get("annual") or {}
        w.writerow([v.name, a.name, a.effect, a.scenario or "", a.asset or "", a.threat or ""]
                   + [x for top, sub in FACTOR_COLUMNS for x in _factor(a.inputs, top, sub)]
                   + [r.get("chance"), r.get("mean"), r.get("p90"), r.get("p95"), (a.result or {}).get("liability_cap")])
    return out.getvalue()


def import_rows(content: bytes, vendors: Dict[str, Vendor]) -> Tuple[List[dict], List[str]]:
    rows, problems = [], []
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig", errors="replace")))
    for i, raw in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        if not any(row.values()):
            continue
        vendor = vendors.get(row.get("vendor", "").lower())
        if vendor is None:
            problems.append(f"Row {i}: no supplier called '{row.get('vendor', '')}'")
            continue
        try:
            inputs = {"tef": None, "vulnerability": None, "primary": {}, "secondary": {}}
            for top, sub in FACTOR_COLUMNS:
                key = sub or top
                values = [row.get(f"{key}_{end}", "") for end in ("least", "likely", "most")]
                triple = [float(x) if x != "" else 0.0 for x in values]
                if sub is None:
                    inputs[top] = triple
                else:
                    inputs[top][sub] = triple
            inputs = clean(inputs)
        except ValueError as exc:
            problems.append(f"Row {i}: {exc}")
            continue
        effect = row.get("effect", "confidentiality").lower() or "confidentiality"
        if effect not in EFFECTS:
            problems.append(f"Row {i}: effect must be one of {', '.join(EFFECTS)}")
            continue
        rows.append({"vendor": vendor, "name": (row.get("name") or f"{vendor.name}: {effect}")[:255], "effect": effect,
                     "scenario": row.get("scenario") or None, "asset": (row.get("asset") or None),
                     "threat": (row.get("threat") or None), "inputs": inputs})
    return rows, problems


# ── REST ─────────────────────────────────────────────────────────────────────

def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _vendor(db: Session, vendor_id: int, tids: List[int]) -> Vendor:
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return v


def _analysis(db: Session, analysis_id: int, tids: List[int]) -> Tuple[TPRAFairAnalysis, Vendor]:
    row = (db.query(TPRAFairAnalysis, Vendor).join(Vendor, Vendor.id == TPRAFairAnalysis.vendor_id)
           .filter(TPRAFairAnalysis.id == analysis_id, TPRAFairAnalysis.tenant_id.in_(tids),
                   TPRAFairAnalysis.deleted_at.is_(None)).first())
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Analysis not found")
    return row


def _run(a: TPRAFairAnalysis) -> None:
    a.result = simulate(a.inputs, _seed(a.vendor_id, a.inputs))
    a.run_at = datetime.utcnow()


def _out(a: TPRAFairAnalysis, v: Vendor, currency: str, full: bool = True) -> dict:
    row = {"id": a.id, "vendor": {"id": v.id, "name": v.name, "tier": v.tier}, "name": a.name, "effect": a.effect,
           "scenario": a.scenario, "asset": a.asset, "threat": a.threat, "status": a.status, "currency": currency,
           "annual": (a.result or {}).get("annual"), "liability_cap": (a.result or {}).get("liability_cap"),
           "updated_at": a.updated_at, "run_at": a.run_at, "row_version": a.row_version}
    if full:
        row.update({"inputs": a.inputs, "notes": a.notes or [], "result": a.result})
    return row


@router.get("/fair")
def list_analyses(vendor_id: Optional[int] = None, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tids(user, db)[0]
    query = (db.query(TPRAFairAnalysis, Vendor).join(Vendor, Vendor.id == TPRAFairAnalysis.vendor_id)
             .filter(TPRAFairAnalysis.tenant_id == tid, TPRAFairAnalysis.deleted_at.is_(None)))
    if vendor_id:
        query = query.filter(TPRAFairAnalysis.vendor_id == vendor_id)
    currency = q._config(db, tid)["currency"]
    rows = [_out(a, v, currency, full=False) for a, v in query.order_by(TPRAFairAnalysis.updated_at.desc())]
    return {"items": rows, "currency": currency}


@router.get("/vendors/{vendor_id}/fair/prefill")
def prefilled(vendor_id: int, effect: str = Query("confidentiality", pattern="^(confidentiality|integrity|availability)$"),
              db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    v = _vendor(db, vendor_id, _tids(user, db))
    inputs, notes = prefill(db, v, effect)
    return {"inputs": inputs, "notes": notes, "currency": q._config(db, v.tenant_id)["currency"],
            "name": f"{v.name}: {'outage' if effect == 'availability' else 'data breach' if effect == 'confidentiality' else 'data tampered with'}"}


class AnalysisIn(BaseModel):
    vendor_id: Optional[int] = None
    name: Optional[str] = Field(None, max_length=255)
    effect: Optional[str] = Field(None, pattern="^(confidentiality|integrity|availability)$")
    scenario: Optional[str] = Field(None, max_length=4000)
    asset: Optional[str] = Field(None, max_length=255)
    threat: Optional[str] = Field(None, max_length=255)
    inputs: Optional[dict] = None
    notes: Optional[List[str]] = None
    status: Optional[str] = Field(None, pattern="^(draft|final)$")
    row_version: Optional[int] = None


@router.post("/fair", status_code=status.HTTP_201_CREATED)
def create(body: AnalysisIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    rbac.require_write(db, user, "assessments", "edit")
    if not body.vendor_id or not body.inputs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose the supplier and give the inputs")
    v = _vendor(db, body.vendor_id, tids)
    try:
        inputs = clean(body.inputs)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    a = TPRAFairAnalysis(tenant_id=v.tenant_id, vendor_id=v.id, name=" ".join((body.name or f"{v.name}: {body.effect or 'confidentiality'}").split())[:255],
                         effect=body.effect or "confidentiality", scenario=body.scenario, asset=body.asset, threat=body.threat,
                         inputs=inputs, notes=[str(n)[:300] for n in (body.notes or [])][:20], status=body.status or "draft",
                         created_by=user.id)
    _run(a)
    db.add(a)
    db.flush()
    service.write_audit(db, v.tenant_id, entity="fair_analysis", action="create", vendor_id=v.id, entity_id=a.id,
                        actor_id=user.id, to_value=a.name)
    db.commit()
    return _out(a, v, q._config(db, v.tenant_id)["currency"])


@router.get("/fair/export.csv")
def export_all(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tid = _tids(user, db)[0]
    rows = (db.query(TPRAFairAnalysis, Vendor).join(Vendor, Vendor.id == TPRAFairAnalysis.vendor_id)
            .filter(TPRAFairAnalysis.tenant_id == tid, TPRAFairAnalysis.deleted_at.is_(None))
            .order_by(Vendor.name, TPRAFairAnalysis.name).all())
    return Response(export_rows(rows), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="fair-analyses.csv"'})


@router.get("/fair/import/template")
def template(user: GRCUser = Depends(require_auth)):
    return Response(",".join(CSV_COLUMNS) + "\r\n", media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="fair-analyses-template.csv"'})


@router.post("/fair/import")
async def import_analyses(file: UploadFile = File(...), dry_run: bool = Query(True), db: Session = Depends(get_db),
                          user: GRCUser = Depends(require_auth)):
    tid = _tids(user, db)[0]
    rbac.require_write(db, user, "assessments", "edit")
    content = await file.read(2 * 1024 * 1024 + 1)
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file is larger than 2 MB")
    vendors = {v.name.strip().lower(): v for v in db.query(Vendor).filter(Vendor.tenant_id == tid, Vendor.deleted_at.is_(None))}
    rows, problems = import_rows(content, vendors)
    if len(rows) > 500:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Split the file: at most 500 analyses at a time")
    if not dry_run and not problems:
        for r in rows:
            a = TPRAFairAnalysis(tenant_id=tid, vendor_id=r["vendor"].id, name=r["name"], effect=r["effect"],
                                 scenario=r["scenario"], asset=r["asset"], threat=r["threat"], inputs=r["inputs"],
                                 notes=["Imported from a CSV file."], created_by=user.id)
            _run(a)
            db.add(a)
        service.write_audit(db, tid, entity="fair_analysis", action="import", actor_id=user.id,
                            to_value=f"{len(rows)} analyses", reason=file.filename)
        db.commit()
    return {"ready": len(rows), "problems": problems[:100], "dry_run": dry_run or bool(problems),
            "names": [r["name"] for r in rows][:100]}


@router.get("/fair/{analysis_id}")
def read(analysis_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    a, v = _analysis(db, analysis_id, _tids(user, db))
    return _out(a, v, q._config(db, a.tenant_id)["currency"])


@router.get("/fair/{analysis_id}/export.csv")
def export_one(analysis_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    a, v = _analysis(db, analysis_id, _tids(user, db))
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Comply analysis", a.name])
    w.writerow(["Supplier", v.name])
    w.writerow(["Effect", a.effect])
    w.writerow([])
    w.writerow(["Factor", "Least", "Most likely", "Most"])
    labels = {"tef": "Threat event frequency (a year)", "vulnerability": "Vulnerability (0 to 1)",
              "probability": "Secondary loss event frequency (0 to 1)", **PRIMARY, **SECONDARY}
    for top, sub in FACTOR_COLUMNS:
        w.writerow([labels[sub or top], *_factor(a.inputs, top, sub)])
    r = a.result or {}
    w.writerow([])
    w.writerow(["Result", "Value"])
    for label, value in (("Chance of a loss in a year", (r.get("annual") or {}).get("chance")),
                         ("Average year", (r.get("annual") or {}).get("mean")),
                         ("One year in ten", (r.get("annual") or {}).get("p90")),
                         ("One year in twenty", (r.get("annual") or {}).get("p95")),
                         ("One year in a hundred", (r.get("annual") or {}).get("p99")),
                         ("Least liability cap to accept", r.get("liability_cap"))):
        w.writerow([label, value])
    w.writerow([])
    w.writerow(["Loss exceedance: a year costing at least", "Chance"])
    for point in r.get("lec") or []:
        w.writerow([point["loss"], point["chance"]])
    safe = "".join(c for c in a.name if c.isalnum() or c in " -_")[:60].strip() or "analysis"
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{safe}.csv"'})


@router.put("/fair/{analysis_id}")
def update(analysis_id: int, body: AnalysisIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    a, v = _analysis(db, analysis_id, _tids(user, db))
    rbac.require_write(db, user, "assessments", "edit")
    if body.row_version is not None and body.row_version != a.row_version:
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone else changed this analysis; reload it")
    changed = []
    if body.inputs is not None:
        try:
            inputs = clean(body.inputs)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
        if inputs != a.inputs:
            a.inputs = inputs
            changed.append("inputs")
    for field in ("name", "effect", "scenario", "asset", "threat", "status"):
        value = getattr(body, field)
        if value is not None and value != getattr(a, field):
            setattr(a, field, " ".join(value.split())[:255] if field == "name" else value)
            changed.append(field)
    if body.notes is not None:
        a.notes = [str(n)[:300] for n in body.notes][:20]
    if "inputs" in changed:
        _run(a)
    if changed:
        a.row_version = (a.row_version or 1) + 1
        service.write_audit(db, a.tenant_id, entity="fair_analysis", action="update", vendor_id=v.id, entity_id=a.id,
                            actor_id=user.id, to_value=", ".join(changed))
    db.commit()
    return _out(a, v, q._config(db, a.tenant_id)["currency"])


@router.delete("/fair/{analysis_id}")
def delete(analysis_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    a, v = _analysis(db, analysis_id, _tids(user, db))
    rbac.require_write(db, user, "assessments", "delete")
    a.deleted_at = datetime.utcnow()
    service.write_audit(db, a.tenant_id, entity="fair_analysis", action="delete", vendor_id=v.id, entity_id=a.id,
                        actor_id=user.id, from_value=a.name)
    db.commit()
    return {"deleted": True, "id": a.id}
