from typing import Optional
from datetime import datetime, timedelta
from collections import defaultdict
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import extract

from ....models import (
    AuditEngagement, AuditTeamMember, AuditTimeEntry, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/capacity", tags=["Audit - Capacity Planning"])


@router.get("/calendar")
def get_capacity_calendar(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    quarter: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"auditors": [], "year": year or datetime.utcnow().year}

    target_year = year or datetime.utcnow().year

    if quarter:
        start_month = (quarter - 1) * 3 + 1
        end_month = start_month + 2
    elif month:
        start_month = month
        end_month = month
    else:
        start_month = 1
        end_month = 12

    period_start = datetime(target_year, start_month, 1)
    if end_month == 12:
        period_end = datetime(target_year + 1, 1, 1)
    else:
        period_end = datetime(target_year, end_month + 1, 1)

    team_members = db.query(AuditTeamMember).join(AuditEngagement).options(
        joinedload(AuditTeamMember.user),
        joinedload(AuditTeamMember.engagement),
    ).filter(
        AuditEngagement.tenant_id.in_(user_tenants),
    ).all()

    auditor_map = {}
    for tm in team_members:
        eng = tm.engagement
        eng_start = eng.planned_start or eng.actual_start or eng.created_at
        eng_end = eng.planned_end or eng.actual_end

        if eng_end and eng_end < period_start:
            continue
        if eng_start and eng_start >= period_end:
            continue

        uid = tm.user_id
        if uid not in auditor_map:
            user_name = (tm.user.display_name or tm.user.username) if tm.user else f"User {uid}"
            auditor_map[uid] = {
                "user_id": uid,
                "user_name": user_name,
                "allocations": [],
                "monthly_hours": {},
            }

        allocation_months = []
        if eng_start:
            cur = max(eng_start.replace(day=1), period_start)
            actual_end = eng_end or period_end
            while cur < min(actual_end, period_end):
                m_key = f"{cur.year}-{cur.month:02d}"
                allocation_months.append(m_key)
                if cur.month == 12:
                    cur = cur.replace(year=cur.year + 1, month=1)
                else:
                    cur = cur.replace(month=cur.month + 1)

        engagement_colors = {
            "planning": "#3b82f6",
            "fieldwork": "#f59e0b",
            "reporting": "#a855f7",
            "follow_up": "#06b6d4",
            "closed": "#22c55e",
        }

        auditor_map[uid]["allocations"].append({
            "engagement_id": eng.id,
            "engagement_title": eng.title,
            "engagement_number": eng.engagement_number,
            "status": eng.status,
            "color": engagement_colors.get(eng.status, "#6366f1"),
            "start": eng_start.isoformat() if eng_start else None,
            "end": eng_end.isoformat() if eng_end else None,
            "availability_percent": tm.availability_percent,
            "role": tm.role,
            "budget_hours": eng.budget_hours or 0,
            "months": allocation_months,
        })

        hours_per_month = (eng.budget_hours or 0) / max(len(allocation_months), 1)
        for m in allocation_months:
            auditor_map[uid]["monthly_hours"][m] = auditor_map[uid]["monthly_hours"].get(m, 0) + hours_per_month

    auditors = list(auditor_map.values())

    months = []
    cur_m = start_month
    while cur_m <= end_month:
        months.append(f"{target_year}-{cur_m:02d}")
        cur_m += 1

    return {
        "auditors": auditors,
        "year": target_year,
        "months": months,
        "period": {
            "start_month": start_month,
            "end_month": end_month,
        }
    }


@router.get("/utilization")
def get_utilization(
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"utilization": [], "summary": {}}

    target_year = year or datetime.utcnow().year

    team_members = db.query(AuditTeamMember).join(AuditEngagement).options(
        joinedload(AuditTeamMember.user),
        joinedload(AuditTeamMember.engagement),
    ).filter(
        AuditEngagement.tenant_id.in_(user_tenants),
    ).all()

    time_entries = db.query(AuditTimeEntry).join(AuditEngagement).filter(
        AuditEngagement.tenant_id.in_(user_tenants),
        extract('year', AuditTimeEntry.date) == target_year,
    ).all()

    time_by_user = defaultdict(float)
    for te in time_entries:
        time_by_user[te.user_id] += te.hours

    auditor_stats = {}
    for tm in team_members:
        uid = tm.user_id
        eng = tm.engagement
        if uid not in auditor_stats:
            user_name = (tm.user.display_name or tm.user.username) if tm.user else f"User {uid}"
            auditor_stats[uid] = {
                "user_id": uid,
                "user_name": user_name,
                "total_budget_hours": 0,
                "total_actual_hours": time_by_user.get(uid, 0),
                "engagement_count": 0,
                "active_engagements": 0,
                "total_availability_allocated": 0,
            }
        auditor_stats[uid]["total_budget_hours"] += eng.budget_hours or 0
        auditor_stats[uid]["engagement_count"] += 1
        if eng.status not in ("closed", "completed"):
            auditor_stats[uid]["active_engagements"] += 1
        auditor_stats[uid]["total_availability_allocated"] += tm.availability_percent

    available_hours_per_year = 1800

    utilization = []
    for uid, stats in auditor_stats.items():
        budget_util = round((stats["total_budget_hours"] / available_hours_per_year) * 100, 1) if available_hours_per_year > 0 else 0
        actual_util = round((stats["total_actual_hours"] / available_hours_per_year) * 100, 1) if available_hours_per_year > 0 else 0
        utilization.append({
            **stats,
            "available_hours": available_hours_per_year,
            "budget_utilization_pct": min(budget_util, 200),
            "actual_utilization_pct": min(actual_util, 200),
            "is_over_allocated": budget_util > 100,
            "capacity_status": "over" if budget_util > 100 else "optimal" if budget_util > 70 else "under",
        })

    utilization.sort(key=lambda x: x["budget_utilization_pct"], reverse=True)

    total_budget = sum(u["total_budget_hours"] for u in utilization)
    total_actual = sum(u["total_actual_hours"] for u in utilization)
    total_available = available_hours_per_year * len(utilization) if utilization else 1
    over_count = sum(1 for u in utilization if u["is_over_allocated"])

    return {
        "utilization": utilization,
        "year": target_year,
        "summary": {
            "total_auditors": len(utilization),
            "total_budget_hours": round(total_budget, 1),
            "total_actual_hours": round(total_actual, 1),
            "total_available_hours": total_available,
            "team_utilization_pct": round((total_budget / total_available) * 100, 1) if total_available > 0 else 0,
            "over_allocated_count": over_count,
            "under_utilized_count": sum(1 for u in utilization if u["capacity_status"] == "under"),
        }
    }


@router.get("/conflicts")
def get_conflicts(
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"conflicts": []}

    target_year = year or datetime.utcnow().year

    team_members = db.query(AuditTeamMember).join(AuditEngagement).options(
        joinedload(AuditTeamMember.user),
        joinedload(AuditTeamMember.engagement),
    ).filter(
        AuditEngagement.tenant_id.in_(user_tenants),
        AuditEngagement.status.notin_(["closed", "completed"]),
    ).all()

    user_assignments = defaultdict(list)
    for tm in team_members:
        eng = tm.engagement
        user_assignments[tm.user_id].append({
            "team_member": tm,
            "engagement": eng,
            "start": eng.planned_start or eng.actual_start or eng.created_at,
            "end": eng.planned_end or eng.actual_end,
            "availability_percent": tm.availability_percent,
        })

    conflicts = []
    for uid, assignments in user_assignments.items():
        total_alloc = sum(a["availability_percent"] for a in assignments)

        if total_alloc > 100:
            user_name = None
            for a in assignments:
                tm = a["team_member"]
                if tm.user:
                    user_name = tm.user.display_name or tm.user.username
                    break

            overlapping = []
            for i, a1 in enumerate(assignments):
                for j, a2 in enumerate(assignments):
                    if j <= i:
                        continue
                    s1, e1 = a1["start"], a1["end"]
                    s2, e2 = a2["start"], a2["end"]
                    if s1 and s2:
                        end1 = e1 or datetime(target_year, 12, 31)
                        end2 = e2 or datetime(target_year, 12, 31)
                        if s1 <= end2 and s2 <= end1:
                            overlapping.append({
                                "engagement_a": {
                                    "id": a1["engagement"].id,
                                    "title": a1["engagement"].title,
                                    "status": a1["engagement"].status,
                                    "availability_pct": a1["availability_percent"],
                                },
                                "engagement_b": {
                                    "id": a2["engagement"].id,
                                    "title": a2["engagement"].title,
                                    "status": a2["engagement"].status,
                                    "availability_pct": a2["availability_percent"],
                                },
                            })

            conflicts.append({
                "user_id": uid,
                "user_name": user_name or f"User {uid}",
                "total_allocation_pct": total_alloc,
                "active_engagements": len(assignments),
                "severity": "critical" if total_alloc > 150 else "high" if total_alloc > 120 else "warning",
                "overlapping_engagements": overlapping,
                "engagements": [{
                    "id": a["engagement"].id,
                    "title": a["engagement"].title,
                    "status": a["engagement"].status,
                    "availability_pct": a["availability_percent"],
                    "start": a["start"].isoformat() if a["start"] else None,
                    "end": a["end"].isoformat() if a["end"] else None,
                } for a in assignments],
            })

    conflicts.sort(key=lambda x: x["total_allocation_pct"], reverse=True)

    return {
        "conflicts": conflicts,
        "total_conflicts": len(conflicts),
        "year": target_year,
    }
