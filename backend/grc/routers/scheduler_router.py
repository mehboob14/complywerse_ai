"""Administration → Scheduler: the platform's recurring jobs and when they last ran.

Reads what the platform clock (services/platform_clock.py) recorded on the master
database. "Run now" queues a job immediately.
"""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_master_db
from ..services import platform_clock
from .auth_router import require_tenant_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/scheduler", tags=["Administration"])


@router.get("")
def list_jobs(
    master: Session = Depends(get_master_db),
    _: bool = Depends(require_tenant_permission("admin:settings:view")),
):
    disabled = os.getenv("DISABLE_PLATFORM_CLOCK", "").strip().lower() in ("1", "true", "yes", "on")
    return {
        "clock": {"enabled": not disabled, "tick_seconds": platform_clock.TICK_SECONDS},
        "jobs": platform_clock.status(master),
    }


@router.post("/{job_key}/run")
def run_job_now(
    job_key: str,
    master: Session = Depends(get_master_db),
    _: bool = Depends(require_tenant_permission("admin:settings:edit")),
):
    try:
        return platform_clock.run_now(master, job_key)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No scheduled job called '{job_key}'")
    except Exception as exc:  # noqa: BLE001 — usually the queue being unreachable
        logger.warning("could not queue %s by hand: %s", job_key, exc)
        raise HTTPException(status_code=503, detail=f"Could not reach the job queue: {type(exc).__name__}")
