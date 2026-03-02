import math
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ....models import RegulatoryChange, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tools", tags=["Audit - Tools"])


class SamplingCalculatorRequest(BaseModel):
    population_size: int
    confidence_level: float = 95.0
    expected_error_rate: float = 5.0
    tolerable_error_rate: float = 10.0
    sampling_type: Optional[str] = "attribute"


Z_SCORES = {
    90.0: 1.645,
    95.0: 1.960,
    99.0: 2.576,
}


@router.post("/sampling-calculator")
def sampling_calculator(
    data: SamplingCalculatorRequest,
    current_user: GRCUser = Depends(require_auth)
):
    pop = data.population_size
    if pop <= 0:
        raise HTTPException(status_code=400, detail="Population size must be positive")

    conf = data.confidence_level
    z = Z_SCORES.get(conf)
    if z is None:
        closest = min(Z_SCORES.keys(), key=lambda k: abs(k - conf))
        z = Z_SCORES[closest]
        conf = closest

    p = data.expected_error_rate / 100.0
    e = data.tolerable_error_rate / 100.0

    if e <= 0:
        raise HTTPException(status_code=400, detail="Tolerable error rate must be positive")
    if p >= e:
        raise HTTPException(status_code=400, detail="Expected error rate must be less than tolerable error rate")

    results = {}

    if data.sampling_type == "attribute":
        n0 = (z * z * p * (1 - p)) / (e * e)
        sample_size = math.ceil(n0 / (1 + (n0 - 1) / pop)) if pop > 0 else math.ceil(n0)
        sample_size = min(sample_size, pop)
        sample_size = max(sample_size, 1)

        results = {
            "sample_size": sample_size,
            "methodology": "Attribute Sampling",
            "formula": "n = (Z² × p × (1-p)) / E² with finite population correction",
            "parameters_used": {
                "population_size": pop,
                "confidence_level": f"{conf}%",
                "z_score": z,
                "expected_error_rate": f"{data.expected_error_rate}%",
                "tolerable_error_rate": f"{data.tolerable_error_rate}%",
            },
            "interpretation": f"To achieve {conf}% confidence with a tolerable error rate of {data.tolerable_error_rate}%, you need to test {sample_size} items from a population of {pop}.",
        }

    elif data.sampling_type == "mus":
        if data.tolerable_error_rate <= 0:
            raise HTTPException(status_code=400, detail="Tolerable error rate required for MUS")

        reliability_factors = {90.0: 2.31, 95.0: 3.00, 99.0: 4.61}
        rf = reliability_factors.get(conf, 3.00)
        tolerable_misstatement = pop * (data.tolerable_error_rate / 100.0)
        if tolerable_misstatement <= 0:
            raise HTTPException(status_code=400, detail="Tolerable misstatement too small")
        sampling_interval = tolerable_misstatement / rf
        sample_size = math.ceil(pop / sampling_interval) if sampling_interval > 0 else pop
        sample_size = min(sample_size, pop)
        sample_size = max(sample_size, 1)

        results = {
            "sample_size": sample_size,
            "methodology": "Monetary Unit Sampling (MUS)",
            "sampling_interval": round(sampling_interval, 2),
            "formula": "Sampling Interval = Tolerable Misstatement / Reliability Factor; Sample Size = Population / Interval",
            "parameters_used": {
                "population_size": pop,
                "confidence_level": f"{conf}%",
                "reliability_factor": rf,
                "tolerable_error_rate": f"{data.tolerable_error_rate}%",
                "tolerable_misstatement": round(tolerable_misstatement, 2),
            },
            "interpretation": f"Select every {round(sampling_interval, 2)}th monetary unit. This gives {sample_size} sampling units at {conf}% confidence.",
        }

    else:
        n0 = (z * z * 0.25) / (e * e)
        sample_size = math.ceil(n0 / (1 + (n0 - 1) / pop)) if pop > 0 else math.ceil(n0)
        sample_size = min(sample_size, pop)
        sample_size = max(sample_size, 1)

        results = {
            "sample_size": sample_size,
            "methodology": "Simple Random Sampling",
            "formula": "n = (Z² × 0.25) / E² with finite population correction",
            "parameters_used": {
                "population_size": pop,
                "confidence_level": f"{conf}%",
                "z_score": z,
                "margin_of_error": f"{data.tolerable_error_rate}%",
            },
            "interpretation": f"You need to sample {sample_size} items from {pop} for {conf}% confidence.",
        }

    common_benchmarks = []
    for cl in [90.0, 95.0, 99.0]:
        zb = Z_SCORES[cl]
        n0b = (zb * zb * p * (1 - p)) / (e * e)
        sb = math.ceil(n0b / (1 + (n0b - 1) / pop)) if pop > 0 else math.ceil(n0b)
        sb = min(max(sb, 1), pop)
        common_benchmarks.append({"confidence_level": f"{cl}%", "sample_size": sb})

    results["benchmarks"] = common_benchmarks
    return results


@router.get("/regulatory-changes")
def get_regulatory_changes(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    status: Optional[str] = Query(None),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    query = db.query(RegulatoryChange).filter(
        RegulatoryChange.tenant_id.in_(user_tenants)
    )

    if status:
        query = query.filter(RegulatoryChange.status == status)

    changes = query.order_by(RegulatoryChange.created_at.desc()).limit(50).all()

    return {
        "changes": [
            {
                "id": c.id,
                "title": c.title,
                "description": c.description,
                "source": c.source,
                "priority": c.priority,
                "status": c.status,
                "effective_date": c.effective_date.isoformat() if c.effective_date else None,
                "published_date": c.published_date.isoformat() if c.published_date else None,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in changes
        ],
        "total": len(changes),
    }
