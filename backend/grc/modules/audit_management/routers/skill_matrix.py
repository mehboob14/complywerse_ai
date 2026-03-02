from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel

from ....models import (
    AuditorSkill, GRCUser, AuditEngagement, AuditTeamMember,
    get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/skill-matrix", tags=["Audit - Skill Matrix"])


class SkillCreate(BaseModel):
    user_id: int
    skill_name: str
    skill_category: Optional[str] = "general"
    proficiency_level: Optional[str] = "intermediate"
    certification: Optional[str] = None
    certification_expiry: Optional[str] = None
    years_experience: Optional[float] = 0
    notes: Optional[str] = None


class SkillUpdate(BaseModel):
    skill_name: Optional[str] = None
    skill_category: Optional[str] = None
    proficiency_level: Optional[str] = None
    certification: Optional[str] = None
    certification_expiry: Optional[str] = None
    years_experience: Optional[float] = None
    notes: Optional[str] = None


class ProfileUpsert(BaseModel):
    user_id: int
    skills: list = []
    certifications: list = []
    specializations: list = []
    frameworks_experience: list = []


PROFICIENCY_LEVELS = ["beginner", "intermediate", "advanced", "expert", "master"]


def proficiency_to_number(level: str) -> int:
    mapping = {"beginner": 1, "intermediate": 2, "advanced": 3, "expert": 4, "master": 5}
    return mapping.get(level.lower(), 2)


def serialize_skill(s: AuditorSkill) -> dict:
    return {
        "id": s.id,
        "tenant_id": s.tenant_id,
        "user_id": s.user_id,
        "skill_name": s.skill_name,
        "skill_category": s.skill_category,
        "proficiency_level": s.proficiency_level,
        "proficiency_number": proficiency_to_number(s.proficiency_level or "intermediate"),
        "certification": s.certification,
        "certification_expiry": s.certification_expiry.isoformat() if s.certification_expiry else None,
        "years_experience": s.years_experience,
        "notes": s.notes,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


@router.get("")
def list_profiles(
    user_id: Optional[int] = Query(None),
    skill: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    query = db.query(AuditorSkill).filter(AuditorSkill.tenant_id.in_(user_tenants))

    if user_id:
        query = query.filter(AuditorSkill.user_id == user_id)
    if skill:
        query = query.filter(AuditorSkill.skill_name.ilike(f"%{skill}%"))
    if category:
        query = query.filter(AuditorSkill.skill_category == category)

    skills = query.order_by(AuditorSkill.user_id, AuditorSkill.skill_category, AuditorSkill.skill_name).all()

    profiles: dict = {}
    for s in skills:
        uid = s.user_id
        if uid not in profiles:
            user = db.query(GRCUser).filter(GRCUser.id == uid).first()
            profiles[uid] = {
                "user_id": uid,
                "display_name": user.display_name or user.username if user else f"User {uid}",
                "email": user.email if user else "",
                "skills": [],
                "certifications": [],
                "engagement_count": 0,
            }
        profiles[uid]["skills"].append(serialize_skill(s))
        if s.certification:
            profiles[uid]["certifications"].append({
                "name": s.certification,
                "skill": s.skill_name,
                "expiry_date": s.certification_expiry.isoformat() if s.certification_expiry else None,
                "is_expired": s.certification_expiry < datetime.utcnow() if s.certification_expiry else False,
            })

    for uid in profiles:
        try:
            eng_count = db.query(func.count(AuditTeamMember.id)).filter(
                AuditTeamMember.user_id == uid
            ).scalar() or 0
            profiles[uid]["engagement_count"] = eng_count
        except Exception:
            profiles[uid]["engagement_count"] = 0

    return {"profiles": list(profiles.values()), "total": len(profiles)}


@router.get("/user/{user_id}")
def get_profile(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    skills = db.query(AuditorSkill).filter(
        AuditorSkill.tenant_id.in_(user_tenants),
        AuditorSkill.user_id == user_id,
    ).order_by(AuditorSkill.skill_category, AuditorSkill.skill_name).all()

    user = db.query(GRCUser).filter(GRCUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    certifications = []
    for s in skills:
        if s.certification:
            certifications.append({
                "name": s.certification,
                "skill": s.skill_name,
                "expiry_date": s.certification_expiry.isoformat() if s.certification_expiry else None,
                "is_expired": s.certification_expiry < datetime.utcnow() if s.certification_expiry else False,
            })

    try:
        eng_count = db.query(func.count(AuditTeamMember.id)).filter(
            AuditTeamMember.user_id == user_id
        ).scalar() or 0
    except Exception:
        eng_count = 0

    return {
        "user_id": user_id,
        "display_name": user.display_name or user.username,
        "email": user.email,
        "skills": [serialize_skill(s) for s in skills],
        "certifications": certifications,
        "engagement_count": eng_count,
    }


@router.post("")
def create_skill(
    data: SkillCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")

    expiry = None
    if data.certification_expiry:
        try:
            expiry = datetime.fromisoformat(data.certification_expiry)
        except ValueError:
            pass

    skill = AuditorSkill(
        tenant_id=tenant_id,
        user_id=data.user_id,
        skill_name=data.skill_name,
        skill_category=data.skill_category or "general",
        proficiency_level=data.proficiency_level or "intermediate",
        certification=data.certification,
        certification_expiry=expiry,
        years_experience=data.years_experience or 0,
        notes=data.notes,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return serialize_skill(skill)


@router.put("/{skill_id}")
def update_skill(
    skill_id: int,
    data: SkillUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    skill = db.query(AuditorSkill).filter(
        AuditorSkill.id == skill_id,
        AuditorSkill.tenant_id.in_(user_tenants),
    ).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    if data.skill_name is not None:
        skill.skill_name = data.skill_name
    if data.skill_category is not None:
        skill.skill_category = data.skill_category
    if data.proficiency_level is not None:
        skill.proficiency_level = data.proficiency_level
    if data.certification is not None:
        skill.certification = data.certification
    if data.certification_expiry is not None:
        try:
            skill.certification_expiry = datetime.fromisoformat(data.certification_expiry)
        except ValueError:
            skill.certification_expiry = None
    if data.years_experience is not None:
        skill.years_experience = data.years_experience
    if data.notes is not None:
        skill.notes = data.notes

    db.commit()
    db.refresh(skill)
    return serialize_skill(skill)


@router.delete("/{skill_id}")
def delete_skill(
    skill_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    skill = db.query(AuditorSkill).filter(
        AuditorSkill.id == skill_id,
        AuditorSkill.tenant_id.in_(user_tenants),
    ).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    db.delete(skill)
    db.commit()
    return {"message": "Skill deleted"}


@router.put("/profile/upsert")
def upsert_profile(
    data: ProfileUpsert,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")

    existing = db.query(AuditorSkill).filter(
        AuditorSkill.tenant_id == tenant_id,
        AuditorSkill.user_id == data.user_id,
    ).all()
    for s in existing:
        db.delete(s)
    db.flush()

    created_skills = []
    for skill_data in data.skills:
        expiry = None
        cert_expiry = skill_data.get("certification_expiry")
        if cert_expiry:
            try:
                expiry = datetime.fromisoformat(cert_expiry)
            except ValueError:
                pass

        skill = AuditorSkill(
            tenant_id=tenant_id,
            user_id=data.user_id,
            skill_name=skill_data.get("skill_name", ""),
            skill_category=skill_data.get("skill_category", "general"),
            proficiency_level=skill_data.get("proficiency_level", "intermediate"),
            certification=skill_data.get("certification"),
            certification_expiry=expiry,
            years_experience=skill_data.get("years_experience", 0),
            notes=skill_data.get("notes"),
        )
        db.add(skill)
        created_skills.append(skill)

    db.commit()
    for s in created_skills:
        db.refresh(s)

    return {
        "user_id": data.user_id,
        "skills_count": len(created_skills),
        "skills": [serialize_skill(s) for s in created_skills],
    }


@router.get("/match")
def match_auditors(
    skills: Optional[str] = Query(None, description="Comma-separated skill names"),
    framework: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    min_proficiency: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    query = db.query(AuditorSkill).filter(AuditorSkill.tenant_id.in_(user_tenants))

    if skills:
        skill_list = [s.strip() for s in skills.split(",")]
        conditions = [AuditorSkill.skill_name.ilike(f"%{s}%") for s in skill_list]
        query = query.filter(or_(*conditions))

    if framework:
        query = query.filter(AuditorSkill.skill_name.ilike(f"%{framework}%"))

    if category:
        query = query.filter(AuditorSkill.skill_category == category)

    if min_proficiency:
        min_num = proficiency_to_number(min_proficiency)
        valid_levels = [l for l in PROFICIENCY_LEVELS if proficiency_to_number(l) >= min_num]
        query = query.filter(AuditorSkill.proficiency_level.in_(valid_levels))

    results = query.all()

    matched: dict = {}
    for s in results:
        uid = s.user_id
        if uid not in matched:
            user = db.query(GRCUser).filter(GRCUser.id == uid).first()
            matched[uid] = {
                "user_id": uid,
                "display_name": user.display_name or user.username if user else f"User {uid}",
                "email": user.email if user else "",
                "matched_skills": [],
                "match_score": 0,
            }
        matched[uid]["matched_skills"].append({
            "skill_name": s.skill_name,
            "proficiency_level": s.proficiency_level,
            "proficiency_number": proficiency_to_number(s.proficiency_level or "intermediate"),
            "certification": s.certification,
        })
        matched[uid]["match_score"] += proficiency_to_number(s.proficiency_level or "intermediate")

    sorted_matches = sorted(matched.values(), key=lambda x: x["match_score"], reverse=True)
    return {"matches": sorted_matches, "total": len(sorted_matches)}


@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    skills = db.query(AuditorSkill).filter(AuditorSkill.tenant_id.in_(user_tenants)).all()

    total_auditors = len(set(s.user_id for s in skills))
    total_skills = len(skills)

    category_counts: dict = {}
    proficiency_dist: dict = {}
    expiring_certs = 0

    for s in skills:
        cat = s.skill_category or "general"
        category_counts[cat] = category_counts.get(cat, 0) + 1

        level = s.proficiency_level or "intermediate"
        proficiency_dist[level] = proficiency_dist.get(level, 0) + 1

        if s.certification and s.certification_expiry:
            from datetime import timedelta
            if s.certification_expiry < datetime.utcnow() + timedelta(days=90):
                expiring_certs += 1

    avg_proficiency = 0
    if skills:
        avg_proficiency = round(
            sum(proficiency_to_number(s.proficiency_level or "intermediate") for s in skills) / len(skills), 1
        )

    return {
        "total_auditors": total_auditors,
        "total_skills": total_skills,
        "avg_proficiency": avg_proficiency,
        "expiring_certifications": expiring_certs,
        "categories": [{"category": k, "count": v} for k, v in sorted(category_counts.items(), key=lambda x: x[1], reverse=True)],
        "proficiency_distribution": [{"level": k, "count": v} for k, v in proficiency_dist.items()],
    }
