from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response, Cookie
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta
from models import (get_db, Phase, PhaseTask, PhaseDeliverable, PhaseRequirement,
                   Requirement, SubRequirement, RequiredEvidence,
                   EvidenceSubmission, Finding, Risk,
                   EvidenceStatus, FindingStatus, RiskStatus,
                   SecurityScan, ComplianceAssessment, CDESystem,
                   User, UserRole)
import os
import uuid
import bcrypt
from jose import jwt, JWTError

SECRET_KEY = os.getenv("SESSION_SECRET")
if not SECRET_KEY:
    raise RuntimeError("SESSION_SECRET environment variable must be set")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

router = APIRouter(prefix="/api", tags=["PCI DSS Lifecycle"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


class TaskResponse(BaseModel):
    id: int
    name: str
    is_complete: bool
    class Config:
        from_attributes = True


class DeliverableResponse(BaseModel):
    id: int
    name: str
    class Config:
        from_attributes = True


class PhaseRequirementResponse(BaseModel):
    requirement_id: int
    req_number: int
    name: str
    class Config:
        from_attributes = True


class PhaseResponse(BaseModel):
    id: int
    phase_number: int
    name: str
    description: Optional[str]
    status: str
    is_current: bool
    approval_status: Optional[str] = "not_required"
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    tasks: List[TaskResponse]
    deliverables: List[DeliverableResponse]
    required_requirements: List[PhaseRequirementResponse] = []
    class Config:
        from_attributes = True


class EvidenceSubmissionResponse(BaseModel):
    id: int
    file_name: str
    uploaded_by: str
    uploaded_at: datetime
    status: str
    reviewed_by: Optional[str]
    reviewed_at: Optional[datetime]
    review_notes: Optional[str]
    class Config:
        from_attributes = True


class RequiredEvidenceResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    evidence_type: str
    submissions: List[EvidenceSubmissionResponse]
    has_accepted: bool
    latest_status: Optional[str]
    class Config:
        from_attributes = True


class SubRequirementResponse(BaseModel):
    id: int
    sub_req_number: str
    name: str
    required_evidence: List[RequiredEvidenceResponse]
    total_required: int
    total_accepted: int
    compliance_status: str
    class Config:
        from_attributes = True


class RequirementResponse(BaseModel):
    id: int
    req_number: int
    name: str
    description: Optional[str]
    class Config:
        from_attributes = True


class RequirementWithSubsResponse(BaseModel):
    id: int
    req_number: int
    name: str
    description: Optional[str]
    sub_requirements: List[SubRequirementResponse]
    compliant_count: int
    partial_count: int
    not_started_count: int
    total_count: int
    compliance_percentage: float
    class Config:
        from_attributes = True


class FindingResponse(BaseModel):
    id: int
    sub_requirement_id: Optional[int]
    title: str
    description: Optional[str]
    severity: str
    status: str
    remediation_notes: Optional[str]
    created_at: datetime
    closed_at: Optional[datetime]
    sub_req_number: Optional[str] = None
    class Config:
        from_attributes = True


class RiskResponse(BaseModel):
    id: int
    sub_requirement_id: Optional[int]
    title: str
    description: Optional[str]
    risk_level: str
    owner: Optional[str]
    status: str
    business_justification: Optional[str]
    approved_by: Optional[str]
    approved_at: Optional[datetime]
    created_at: datetime
    sub_req_number: Optional[str] = None
    class Config:
        from_attributes = True


class SecurityScanResponse(BaseModel):
    id: int
    scan_type: str
    name: str
    status: str
    scheduled_date: Optional[datetime]
    completed_date: Optional[datetime]
    findings_count: int
    class Config:
        from_attributes = True


class CDESystemResponse(BaseModel):
    id: int
    name: str
    system_type: str
    description: Optional[str]
    ip_address: Optional[str]
    location: Optional[str]
    owner: Optional[str]
    in_scope: bool
    class Config:
        from_attributes = True


class DashboardStats(BaseModel):
    total_sub_requirements: int
    compliant_count: int
    partial_count: int
    not_started_count: int
    overall_compliance: float
    total_evidence_required: int
    total_evidence_uploaded: int
    total_evidence_accepted: int
    total_evidence_pending: int
    total_evidence_rejected: int
    evidence_completion: float
    open_findings: int
    closed_findings: int
    pending_risks: int
    approved_risks: int
    current_phase: Optional[PhaseResponse]
    cde_systems_count: int
    asv_scans_completed: int
    asv_scans_required: int
    pen_tests_completed: int
    pen_tests_required: int
    last_assessment_date: Optional[str]
    requirements_met: int
    total_requirements: int


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    role: str = "it_security"
    display_name: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    role: str
    display_name: Optional[str]
    is_active: bool
    created_at: datetime
    class Config:
        from_attributes = True


class UserUpdateRequest(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
    display_name: Optional[str] = None
    is_active: Optional[bool] = None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: Optional[str] = Cookie(None, alias="auth_token"), db: Session = Depends(get_db)) -> Optional[User]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            return None
        user = db.query(User).filter(User.username == username).first()
        return user
    except JWTError:
        return None


def require_auth(token: Optional[str] = Cookie(None, alias="auth_token"), db: Session = Depends(get_db)) -> User:
    user = get_current_user(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_role(*roles):
    def role_checker(user: User = Depends(require_auth)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return role_checker


def calculate_sub_req_status(sub_req):
    required = sub_req.required_evidence
    if not required:
        return "compliant", 0, 0
    
    total = len(required)
    accepted = 0
    
    for req_ev in required:
        has_accepted = any(s.status == EvidenceStatus.ACCEPTED.value for s in req_ev.submissions)
        if has_accepted:
            accepted += 1
    
    if accepted == total:
        return "compliant", total, accepted
    elif accepted > 0:
        return "partial", total, accepted
    else:
        return "not_started", total, accepted


def build_required_evidence_response(req_ev):
    submissions = sorted(req_ev.submissions, key=lambda x: x.uploaded_at, reverse=True) if req_ev.submissions else []
    has_accepted = any(s.status == EvidenceStatus.ACCEPTED.value for s in submissions)
    latest_status = submissions[0].status if submissions else None
    
    return RequiredEvidenceResponse(
        id=req_ev.id,
        name=req_ev.name,
        description=req_ev.description,
        evidence_type=req_ev.evidence_type,
        submissions=[EvidenceSubmissionResponse(
            id=s.id,
            file_name=s.file_name,
            uploaded_by=s.uploaded_by,
            uploaded_at=s.uploaded_at,
            status=s.status,
            reviewed_by=s.reviewed_by,
            reviewed_at=s.reviewed_at,
            review_notes=s.review_notes
        ) for s in submissions],
        has_accepted=has_accepted,
        latest_status=latest_status
    )


def build_sub_requirement_response(sub_req):
    status, total, accepted = calculate_sub_req_status(sub_req)
    
    return SubRequirementResponse(
        id=sub_req.id,
        sub_req_number=sub_req.sub_req_number,
        name=sub_req.name,
        required_evidence=[build_required_evidence_response(re) for re in sub_req.required_evidence],
        total_required=total,
        total_accepted=accepted,
        compliance_status=status
    )


@router.post("/auth/register")
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(
        (User.username == request.username) | (User.email == request.email)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    
    user = User(
        username=request.username,
        email=request.email,
        password_hash=hash_password(request.password),
        role=request.role,
        display_name=request.display_name or request.username
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    token = create_access_token({"sub": user.username})
    response = JSONResponse(content={
        "message": "Registration successful",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "display_name": user.display_name
        }
    })
    response.set_cookie(key="auth_token", value=token, httponly=True, max_age=86400)
    return response


@router.post("/auth/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == request.username).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")
    
    user.last_login = datetime.utcnow()
    db.commit()
    
    token = create_access_token({"sub": user.username})
    response = JSONResponse(content={
        "message": "Login successful",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "display_name": user.display_name
        }
    })
    response.set_cookie(key="auth_token", value=token, httponly=True, max_age=86400)
    return response


@router.post("/auth/logout")
def logout():
    response = JSONResponse(content={"message": "Logged out successfully"})
    response.delete_cookie(key="auth_token")
    return response


@router.get("/auth/me")
def get_current_user_info(token: Optional[str] = Cookie(None, alias="auth_token"), db: Session = Depends(get_db)):
    user = get_current_user(token, db)
    if not user:
        return {"authenticated": False, "user": None}
    return {
        "authenticated": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "display_name": user.display_name
        }
    }


@router.get("/users", response_model=List[UserResponse])
def get_all_users(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    return db.query(User).order_by(User.created_at).all()


@router.post("/users")
def create_user(request: RegisterRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    existing = db.query(User).filter(
        (User.username == request.username) | (User.email == request.email)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    
    new_user = User(
        username=request.username,
        email=request.email,
        password_hash=hash_password(request.password),
        role=request.role,
        display_name=request.display_name or request.username
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": "User created", "user_id": new_user.id}


@router.patch("/users/{user_id}")
def update_user(user_id: int, request: UserUpdateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if request.email:
        target_user.email = request.email
    if request.role:
        target_user.role = request.role
    if request.display_name:
        target_user.display_name = request.display_name
    if request.is_active is not None:
        target_user.is_active = request.is_active
    
    db.commit()
    return {"message": "User updated"}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    if target_user.id == user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    db.delete(target_user)
    db.commit()
    return {"message": "User deleted"}


@router.get("/phases")
def get_all_phases(db: Session = Depends(get_db)):
    phases = db.query(Phase).options(
        joinedload(Phase.tasks),
        joinedload(Phase.deliverables),
        joinedload(Phase.required_requirements).joinedload(PhaseRequirement.requirement)
    ).order_by(Phase.phase_number).all()
    
    result = []
    for phase in phases:
        phase_data = {
            "id": phase.id,
            "phase_number": phase.phase_number,
            "name": phase.name,
            "description": phase.description,
            "status": phase.status,
            "is_current": phase.is_current,
            "approval_status": phase.approval_status,
            "approved_by": phase.approved_by,
            "approved_at": phase.approved_at.isoformat() if phase.approved_at else None,
            "tasks": [{"id": t.id, "name": t.name, "is_complete": t.is_complete} for t in phase.tasks],
            "deliverables": [{"id": d.id, "name": d.name} for d in phase.deliverables],
            "required_requirements": [
                {
                    "requirement_id": pr.requirement_id,
                    "req_number": pr.requirement.req_number,
                    "name": pr.requirement.name
                } for pr in phase.required_requirements
            ]
        }
        result.append(phase_data)
    return result


@router.get("/phases/current", response_model=Optional[PhaseResponse])
def get_current_phase(db: Session = Depends(get_db)):
    phase = db.query(Phase).options(
        joinedload(Phase.tasks),
        joinedload(Phase.deliverables)
    ).filter(Phase.is_current == True).first()
    return phase


@router.get("/phases/{phase_id}", response_model=PhaseResponse)
def get_phase(phase_id: int, db: Session = Depends(get_db)):
    phase = db.query(Phase).options(
        joinedload(Phase.tasks),
        joinedload(Phase.deliverables)
    ).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    return phase


@router.patch("/phases/{phase_id}/set-current")
def set_current_phase(phase_id: int, db: Session = Depends(get_db)):
    db.query(Phase).update({"is_current": False})
    phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    phase.is_current = True
    db.commit()
    return {"message": "Current phase updated", "phase": phase.name}


@router.patch("/tasks/{task_id}/toggle")
def toggle_task_completion(task_id: int, db: Session = Depends(get_db)):
    task = db.query(PhaseTask).filter(PhaseTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.is_complete = not task.is_complete
    
    phase = db.query(Phase).filter(Phase.id == task.phase_id).first()
    all_tasks = db.query(PhaseTask).filter(PhaseTask.phase_id == task.phase_id).all()
    all_complete = all(t.is_complete for t in all_tasks)
    
    if all_complete and phase.approval_status == "not_required":
        phase.approval_status = "pending_approval"
        phase.status = "pending_approval"
    elif not all_complete:
        if phase.approval_status in ["pending_approval", "approved"]:
            phase.approval_status = "not_required"
            phase.approved_by = None
            phase.approved_at = None
        phase.status = "in_progress"
    
    db.commit()
    return {
        "message": "Task updated", 
        "task_id": task_id, 
        "is_complete": task.is_complete,
        "all_tasks_complete": all_complete,
        "approval_status": phase.approval_status
    }


@router.post("/phases/{phase_id}/request-approval")
def request_phase_approval(phase_id: int, db: Session = Depends(get_db)):
    phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    all_tasks = db.query(PhaseTask).filter(PhaseTask.phase_id == phase_id).all()
    all_complete = all(t.is_complete for t in all_tasks)
    
    if not all_complete:
        raise HTTPException(status_code=400, detail="All tasks must be completed before requesting approval")
    
    phase.approval_status = "pending_approval"
    phase.status = "pending_approval"
    db.commit()
    
    return {"message": "Approval requested", "phase": phase.name, "approval_status": phase.approval_status}


@router.post("/phases/{phase_id}/approve")
def approve_phase(phase_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin", "business_owner"))):
    phase = db.query(Phase).options(
        joinedload(Phase.required_requirements).joinedload(PhaseRequirement.requirement)
    ).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    if phase.approval_status != "pending_approval":
        raise HTTPException(status_code=400, detail="Phase is not pending approval")
    
    blocking_requirements = []
    for phase_req in phase.required_requirements:
        req = phase_req.requirement
        for sub_req in db.query(SubRequirement).filter(SubRequirement.requirement_id == req.id).all():
            required_evidence_items = db.query(RequiredEvidence).filter(
                RequiredEvidence.sub_requirement_id == sub_req.id
            ).all()
            
            for evidence_item in required_evidence_items:
                accepted_submission = db.query(EvidenceSubmission).filter(
                    EvidenceSubmission.required_evidence_id == evidence_item.id,
                    EvidenceSubmission.status == "accepted"
                ).first()
                
                if not accepted_submission:
                    blocking_requirements.append({
                        "requirement": f"Req {req.req_number}",
                        "sub_requirement": sub_req.sub_req_number,
                        "evidence": evidence_item.name
                    })
    
    if blocking_requirements:
        raise HTTPException(
            status_code=400, 
            detail={
                "message": "Cannot approve phase - missing accepted evidence",
                "blocking_items": blocking_requirements[:10]
            }
        )
    
    phase.approval_status = "approved"
    phase.approved_by = user.display_name or user.username
    phase.approved_at = datetime.utcnow()
    phase.status = "complete"
    db.commit()
    
    return {
        "message": f"Phase '{phase.name}' approved by {phase.approved_by}",
        "phase": phase.name,
        "approved_by": phase.approved_by,
        "approved_at": phase.approved_at.isoformat()
    }


@router.post("/phases/{phase_id}/advance")
def advance_to_next_phase(phase_id: int, db: Session = Depends(get_db)):
    current_phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not current_phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    if current_phase.approval_status != "approved":
        raise HTTPException(status_code=400, detail="Phase must be approved before advancing")
    
    next_phase = db.query(Phase).filter(Phase.phase_number == current_phase.phase_number + 1).first()
    if not next_phase:
        raise HTTPException(status_code=400, detail="Already on final phase")
    
    current_phase.is_current = False
    next_phase.is_current = True
    next_phase.status = "in_progress"
    db.commit()
    
    return {
        "message": f"Advanced to '{next_phase.name}'",
        "previous_phase": current_phase.name,
        "current_phase": next_phase.name
    }


@router.get("/requirements", response_model=List[RequirementWithSubsResponse])
def get_all_requirements(db: Session = Depends(get_db)):
    requirements = db.query(Requirement).options(
        joinedload(Requirement.sub_requirements)
        .joinedload(SubRequirement.required_evidence)
        .joinedload(RequiredEvidence.submissions)
    ).order_by(Requirement.req_number).all()
    
    result = []
    for req in requirements:
        compliant = 0
        partial = 0
        not_started = 0
        
        sub_reqs_response = []
        for sub_req in req.sub_requirements:
            sub_response = build_sub_requirement_response(sub_req)
            sub_reqs_response.append(sub_response)
            
            if sub_response.compliance_status == "compliant":
                compliant += 1
            elif sub_response.compliance_status == "partial":
                partial += 1
            else:
                not_started += 1
        
        total = len(req.sub_requirements)
        percentage = ((compliant + partial * 0.5) / total * 100) if total > 0 else 0
        
        result.append(RequirementWithSubsResponse(
            id=req.id,
            req_number=req.req_number,
            name=req.name,
            description=req.description,
            sub_requirements=sub_reqs_response,
            compliant_count=compliant,
            partial_count=partial,
            not_started_count=not_started,
            total_count=total,
            compliance_percentage=round(percentage, 0)
        ))
    
    return result


@router.get("/requirements/{req_id}", response_model=RequirementWithSubsResponse)
def get_requirement(req_id: int, db: Session = Depends(get_db)):
    req = db.query(Requirement).options(
        joinedload(Requirement.sub_requirements)
        .joinedload(SubRequirement.required_evidence)
        .joinedload(RequiredEvidence.submissions)
    ).filter(Requirement.id == req_id).first()
    
    if not req:
        raise HTTPException(status_code=404, detail="Requirement not found")
    
    compliant = 0
    partial = 0
    not_started = 0
    
    sub_reqs_response = []
    for sub_req in req.sub_requirements:
        sub_response = build_sub_requirement_response(sub_req)
        sub_reqs_response.append(sub_response)
        
        if sub_response.compliance_status == "compliant":
            compliant += 1
        elif sub_response.compliance_status == "partial":
            partial += 1
        else:
            not_started += 1
    
    total = len(req.sub_requirements)
    percentage = ((compliant + partial * 0.5) / total * 100) if total > 0 else 0
    
    return RequirementWithSubsResponse(
        id=req.id,
        req_number=req.req_number,
        name=req.name,
        description=req.description,
        sub_requirements=sub_reqs_response,
        compliant_count=compliant,
        partial_count=partial,
        not_started_count=not_started,
        total_count=total,
        compliance_percentage=round(percentage, 0)
    )


@router.get("/sub-requirements/{sub_req_id}")
def get_sub_requirement(sub_req_id: int, db: Session = Depends(get_db)):
    sub_req = db.query(SubRequirement).options(
        joinedload(SubRequirement.required_evidence)
        .joinedload(RequiredEvidence.submissions)
    ).filter(SubRequirement.id == sub_req_id).first()
    
    if not sub_req:
        raise HTTPException(status_code=404, detail="Sub-requirement not found")
    
    return build_sub_requirement_response(sub_req)


@router.post("/evidence/{required_evidence_id}/upload")
async def upload_evidence(
    required_evidence_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("it_security"))
):
    req_ev = db.query(RequiredEvidence).filter(RequiredEvidence.id == required_evidence_id).first()
    if not req_ev:
        raise HTTPException(status_code=404, detail="Required evidence not found")
    
    file_ext = os.path.splitext(file.filename)[1]
    unique_name = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    submission = EvidenceSubmission(
        required_evidence_id=required_evidence_id,
        file_name=file.filename,
        file_path=file_path,
        uploaded_by=user.display_name or user.username,
        status=EvidenceStatus.PENDING_REVIEW.value
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    
    return {
        "message": "Evidence uploaded successfully",
        "submission_id": submission.id,
        "status": submission.status
    }


@router.get("/evidence/pending")
def get_pending_evidence(db: Session = Depends(get_db)):
    submissions = db.query(EvidenceSubmission).filter(
        EvidenceSubmission.status == EvidenceStatus.PENDING_REVIEW.value
    ).order_by(EvidenceSubmission.uploaded_at.desc()).all()
    
    result = []
    for sub in submissions:
        req_ev = sub.required_evidence
        sub_req = req_ev.sub_requirement
        result.append({
            "submission_id": sub.id,
            "file_name": sub.file_name,
            "uploaded_by": sub.uploaded_by,
            "uploaded_at": sub.uploaded_at.isoformat(),
            "evidence_name": req_ev.name,
            "evidence_type": req_ev.evidence_type,
            "sub_req_number": sub_req.sub_req_number,
            "sub_req_name": sub_req.name
        })
    
    return result


@router.post("/evidence/{submission_id}/review")
def review_evidence(
    submission_id: int,
    action: str,
    notes: str = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("infosec_team"))
):
    submission = db.query(EvidenceSubmission).filter(EvidenceSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    
    if action not in ["accept", "reject"]:
        raise HTTPException(status_code=400, detail="Action must be 'accept' or 'reject'")
    
    submission.reviewed_by = user.display_name or user.username
    submission.reviewed_at = datetime.utcnow()
    submission.review_notes = notes
    
    if action == "accept":
        submission.status = EvidenceStatus.ACCEPTED.value
        open_findings = db.query(Finding).filter(
            Finding.evidence_submission_id == submission_id,
            Finding.status != FindingStatus.CLOSED.value
        ).all()
        for finding in open_findings:
            finding.status = FindingStatus.CLOSED.value
            finding.closed_at = datetime.utcnow()
    else:
        submission.status = EvidenceStatus.REJECTED.value
        req_ev = submission.required_evidence
        sub_req = req_ev.sub_requirement
        
        finding = Finding(
            sub_requirement_id=sub_req.id,
            evidence_submission_id=submission_id,
            title=f"Evidence Rejected: {req_ev.name}",
            description=f"Evidence for requirement {sub_req.sub_req_number} was rejected. Reason: {notes or 'Not specified'}",
            severity="medium",
            status=FindingStatus.OPEN.value
        )
        db.add(finding)
    
    db.commit()
    
    return {
        "message": f"Evidence {action}ed",
        "status": submission.status
    }


@router.get("/dashboard/stats", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    sub_reqs = db.query(SubRequirement).options(
        joinedload(SubRequirement.required_evidence)
        .joinedload(RequiredEvidence.submissions)
    ).all()
    
    compliant = 0
    partial = 0
    not_started = 0
    total_required = 0
    total_accepted = 0
    
    for sub_req in sub_reqs:
        status, req_count, acc_count = calculate_sub_req_status(sub_req)
        total_required += req_count
        total_accepted += acc_count
        
        if status == "compliant":
            compliant += 1
        elif status == "partial":
            partial += 1
        else:
            not_started += 1
    
    total = len(sub_reqs)
    overall = ((compliant + partial * 0.5) / total * 100) if total > 0 else 0
    
    submissions = db.query(EvidenceSubmission).all()
    uploaded = len(submissions)
    accepted = len([s for s in submissions if s.status == EvidenceStatus.ACCEPTED.value])
    pending = len([s for s in submissions if s.status == EvidenceStatus.PENDING_REVIEW.value])
    rejected = len([s for s in submissions if s.status == EvidenceStatus.REJECTED.value])
    
    evidence_completion = (accepted / total_required * 100) if total_required > 0 else 0
    
    findings = db.query(Finding).all()
    open_findings = len([f for f in findings if f.status != FindingStatus.CLOSED.value])
    closed_findings = len([f for f in findings if f.status == FindingStatus.CLOSED.value])
    
    risks = db.query(Risk).all()
    pending_risks = len([r for r in risks if r.status == RiskStatus.PENDING.value])
    approved_risks = len([r for r in risks if r.status == RiskStatus.APPROVED.value])
    
    current_phase = db.query(Phase).options(
        joinedload(Phase.tasks),
        joinedload(Phase.deliverables)
    ).filter(Phase.is_current == True).first()
    
    cde_systems = db.query(CDESystem).filter(CDESystem.in_scope == True).count()
    
    asv_scans = db.query(SecurityScan).filter(SecurityScan.scan_type == "asv_scan").all()
    asv_completed = len([s for s in asv_scans if s.status == "completed"])
    asv_required = 4  # Quarterly requirement
    
    pen_tests = db.query(SecurityScan).filter(SecurityScan.scan_type == "pen_test").all()
    pen_completed = len([p for p in pen_tests if p.status == "completed"])
    pen_required = 2  # Annual external + internal
    
    last_assessment = db.query(ComplianceAssessment).order_by(
        ComplianceAssessment.started_at.desc()
    ).first()
    last_assessment_date = None
    if last_assessment:
        last_assessment_date = last_assessment.started_at.strftime("%b %d, %Y")
    
    return DashboardStats(
        total_sub_requirements=total,
        compliant_count=compliant,
        partial_count=partial,
        not_started_count=not_started,
        overall_compliance=round(overall, 1),
        total_evidence_required=total_required,
        total_evidence_uploaded=uploaded,
        total_evidence_accepted=accepted,
        total_evidence_pending=pending,
        total_evidence_rejected=rejected,
        evidence_completion=round(evidence_completion, 1),
        open_findings=open_findings,
        closed_findings=closed_findings,
        pending_risks=pending_risks,
        approved_risks=approved_risks,
        current_phase=current_phase,
        cde_systems_count=cde_systems,
        asv_scans_completed=asv_completed,
        asv_scans_required=asv_required,
        pen_tests_completed=pen_completed,
        pen_tests_required=pen_required,
        last_assessment_date=last_assessment_date,
        requirements_met=compliant,
        total_requirements=total
    )


@router.get("/findings", response_model=List[FindingResponse])
def get_all_findings(db: Session = Depends(get_db)):
    findings = db.query(Finding).options(
        joinedload(Finding.sub_requirement)
    ).order_by(Finding.created_at.desc()).all()
    
    result = []
    for f in findings:
        result.append(FindingResponse(
            id=f.id,
            sub_requirement_id=f.sub_requirement_id,
            title=f.title,
            description=f.description,
            severity=f.severity,
            status=f.status,
            remediation_notes=f.remediation_notes,
            created_at=f.created_at,
            closed_at=f.closed_at,
            sub_req_number=f.sub_requirement.sub_req_number if f.sub_requirement else None
        ))
    return result


class CreateFindingRequest(BaseModel):
    title: str
    description: str
    severity: str = "medium"
    sub_requirement_id: Optional[int] = None


@router.post("/findings", response_model=dict)
def create_finding(
    request: CreateFindingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "infosec_team"))
):
    if request.severity not in ["low", "medium", "high", "critical"]:
        raise HTTPException(status_code=400, detail="Invalid severity")
    
    finding = Finding(
        title=request.title,
        description=request.description,
        severity=request.severity,
        sub_requirement_id=request.sub_requirement_id,
        status=FindingStatus.OPEN.value,
        created_at=datetime.utcnow()
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)
    return {"message": "Finding created", "id": finding.id}


@router.patch("/findings/{finding_id}")
def update_finding(
    finding_id: int,
    status: str = None,
    remediation_notes: str = None,
    db: Session = Depends(get_db)
):
    finding = db.query(Finding).filter(Finding.id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")
    
    if status:
        if status not in [s.value for s in FindingStatus]:
            raise HTTPException(status_code=400, detail="Invalid status")
        finding.status = status
        if status == FindingStatus.CLOSED.value:
            finding.closed_at = datetime.utcnow()
        else:
            finding.closed_at = None
    
    if remediation_notes:
        finding.remediation_notes = remediation_notes
    
    db.commit()
    return {"message": "Finding updated", "status": finding.status}


@router.get("/risks", response_model=List[RiskResponse])
def get_all_risks(db: Session = Depends(get_db)):
    risks = db.query(Risk).order_by(Risk.created_at.desc()).all()
    
    result = []
    for r in risks:
        sub_req = db.query(SubRequirement).filter(SubRequirement.id == r.sub_requirement_id).first() if r.sub_requirement_id else None
        result.append(RiskResponse(
            id=r.id,
            sub_requirement_id=r.sub_requirement_id,
            title=r.title,
            description=r.description,
            risk_level=r.risk_level,
            owner=r.owner,
            status=r.status,
            business_justification=r.business_justification,
            approved_by=r.approved_by,
            approved_at=r.approved_at,
            created_at=r.created_at,
            sub_req_number=sub_req.sub_req_number if sub_req else None
        ))
    return result


@router.post("/risks")
def create_risk(
    title: str,
    description: str = None,
    risk_level: str = "medium",
    owner: str = None,
    sub_requirement_id: int = None,
    db: Session = Depends(get_db)
):
    risk = Risk(
        title=title,
        description=description,
        risk_level=risk_level,
        owner=owner,
        sub_requirement_id=sub_requirement_id,
        status=RiskStatus.PENDING.value
    )
    db.add(risk)
    db.commit()
    db.refresh(risk)
    return {"message": "Risk created", "risk_id": risk.id}


@router.patch("/risks/{risk_id}/approve")
def approve_risk(
    risk_id: int,
    action: str,
    business_justification: str = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "business_owner"))
):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    
    if action not in ["approve", "reject"]:
        raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")
    
    risk.approved_by = user.display_name or user.username
    risk.approved_at = datetime.utcnow()
    risk.business_justification = business_justification
    risk.status = RiskStatus.APPROVED.value if action == "approve" else RiskStatus.REJECTED.value
    
    db.commit()
    return {"message": f"Risk {action}d", "status": risk.status}


class PhaseCreateRequest(BaseModel):
    phase_number: int
    name: str
    description: Optional[str] = None


class TaskCreateRequest(BaseModel):
    name: str


class RequirementCreateRequest(BaseModel):
    req_number: int
    name: str
    description: Optional[str] = None


class SubRequirementCreateRequest(BaseModel):
    sub_req_number: str
    name: str


class RequiredEvidenceCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    evidence_type: str = "document"


@router.post("/admin/phases")
def admin_create_phase(request: PhaseCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    phase = Phase(
        phase_number=request.phase_number,
        name=request.name,
        description=request.description
    )
    db.add(phase)
    db.commit()
    db.refresh(phase)
    return {"message": "Phase created", "phase_id": phase.id}


@router.put("/admin/phases/{phase_id}")
def admin_update_phase(phase_id: int, request: PhaseCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    phase.phase_number = request.phase_number
    phase.name = request.name
    phase.description = request.description
    db.commit()
    return {"message": "Phase updated"}


@router.delete("/admin/phases/{phase_id}")
def admin_delete_phase(phase_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    db.delete(phase)
    db.commit()
    return {"message": "Phase deleted"}


@router.post("/admin/phases/{phase_id}/tasks")
def admin_create_task(phase_id: int, request: TaskCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    task = PhaseTask(phase_id=phase_id, name=request.name)
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"message": "Task created", "task_id": task.id}


@router.put("/admin/tasks/{task_id}")
def admin_update_task(task_id: int, request: TaskCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    task = db.query(PhaseTask).filter(PhaseTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task.name = request.name
    db.commit()
    return {"message": "Task updated"}


@router.delete("/admin/tasks/{task_id}")
def admin_delete_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    task = db.query(PhaseTask).filter(PhaseTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    db.delete(task)
    db.commit()
    return {"message": "Task deleted"}


@router.post("/admin/phases/{phase_id}/deliverables")
def admin_create_deliverable(phase_id: int, request: TaskCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    deliverable = PhaseDeliverable(phase_id=phase_id, name=request.name)
    db.add(deliverable)
    db.commit()
    db.refresh(deliverable)
    return {"message": "Deliverable created", "deliverable_id": deliverable.id}


@router.put("/admin/deliverables/{deliverable_id}")
def admin_update_deliverable(deliverable_id: int, request: TaskCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    deliverable = db.query(PhaseDeliverable).filter(PhaseDeliverable.id == deliverable_id).first()
    if not deliverable:
        raise HTTPException(status_code=404, detail="Deliverable not found")
    
    deliverable.name = request.name
    db.commit()
    return {"message": "Deliverable updated"}


@router.delete("/admin/deliverables/{deliverable_id}")
def admin_delete_deliverable(deliverable_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    deliverable = db.query(PhaseDeliverable).filter(PhaseDeliverable.id == deliverable_id).first()
    if not deliverable:
        raise HTTPException(status_code=404, detail="Deliverable not found")
    
    db.delete(deliverable)
    db.commit()
    return {"message": "Deliverable deleted"}


@router.get("/admin/phases/{phase_id}/requirements")
def admin_get_phase_requirements(phase_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    phase_reqs = db.query(PhaseRequirement).options(
        joinedload(PhaseRequirement.requirement)
    ).filter(PhaseRequirement.phase_id == phase_id).all()
    
    return [{
        "id": pr.id,
        "requirement_id": pr.requirement_id,
        "req_number": pr.requirement.req_number,
        "name": pr.requirement.name
    } for pr in phase_reqs]


class PhaseRequirementRequest(BaseModel):
    requirement_id: int


@router.post("/admin/phases/{phase_id}/requirements")
def admin_add_phase_requirement(phase_id: int, request: PhaseRequirementRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    requirement = db.query(Requirement).filter(Requirement.id == request.requirement_id).first()
    if not requirement:
        raise HTTPException(status_code=404, detail="Requirement not found")
    
    existing = db.query(PhaseRequirement).filter(
        PhaseRequirement.phase_id == phase_id,
        PhaseRequirement.requirement_id == request.requirement_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Requirement already linked to this phase")
    
    phase_req = PhaseRequirement(phase_id=phase_id, requirement_id=request.requirement_id)
    db.add(phase_req)
    db.commit()
    db.refresh(phase_req)
    
    return {
        "message": f"Requirement {requirement.req_number} linked to phase",
        "id": phase_req.id,
        "requirement_id": requirement.id,
        "req_number": requirement.req_number,
        "name": requirement.name
    }


@router.delete("/admin/phases/{phase_id}/requirements/{requirement_id}")
def admin_remove_phase_requirement(phase_id: int, requirement_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    phase_req = db.query(PhaseRequirement).filter(
        PhaseRequirement.phase_id == phase_id,
        PhaseRequirement.requirement_id == requirement_id
    ).first()
    if not phase_req:
        raise HTTPException(status_code=404, detail="Phase-requirement link not found")
    
    db.delete(phase_req)
    db.commit()
    return {"message": "Requirement unlinked from phase"}


@router.post("/admin/requirements")
def admin_create_requirement(request: RequirementCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    req = Requirement(
        req_number=request.req_number,
        name=request.name,
        description=request.description
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return {"message": "Requirement created", "requirement_id": req.id}


@router.put("/admin/requirements/{req_id}")
def admin_update_requirement(req_id: int, request: RequirementCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    req = db.query(Requirement).filter(Requirement.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Requirement not found")
    
    req.req_number = request.req_number
    req.name = request.name
    req.description = request.description
    db.commit()
    return {"message": "Requirement updated"}


@router.delete("/admin/requirements/{req_id}")
def admin_delete_requirement(req_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    req = db.query(Requirement).filter(Requirement.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Requirement not found")
    
    db.delete(req)
    db.commit()
    return {"message": "Requirement deleted"}


@router.post("/admin/requirements/{req_id}/sub-requirements")
def admin_create_sub_requirement(req_id: int, request: SubRequirementCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    req = db.query(Requirement).filter(Requirement.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Requirement not found")
    
    sub_req = SubRequirement(
        requirement_id=req_id,
        sub_req_number=request.sub_req_number,
        name=request.name
    )
    db.add(sub_req)
    db.commit()
    db.refresh(sub_req)
    return {"message": "Sub-requirement created", "sub_requirement_id": sub_req.id}


@router.put("/admin/sub-requirements/{sub_req_id}")
def admin_update_sub_requirement(sub_req_id: int, request: SubRequirementCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    sub_req = db.query(SubRequirement).filter(SubRequirement.id == sub_req_id).first()
    if not sub_req:
        raise HTTPException(status_code=404, detail="Sub-requirement not found")
    
    sub_req.sub_req_number = request.sub_req_number
    sub_req.name = request.name
    db.commit()
    return {"message": "Sub-requirement updated"}


@router.delete("/admin/sub-requirements/{sub_req_id}")
def admin_delete_sub_requirement(sub_req_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    sub_req = db.query(SubRequirement).filter(SubRequirement.id == sub_req_id).first()
    if not sub_req:
        raise HTTPException(status_code=404, detail="Sub-requirement not found")
    
    db.delete(sub_req)
    db.commit()
    return {"message": "Sub-requirement deleted"}


@router.post("/admin/sub-requirements/{sub_req_id}/evidence")
def admin_create_required_evidence(sub_req_id: int, request: RequiredEvidenceCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    sub_req = db.query(SubRequirement).filter(SubRequirement.id == sub_req_id).first()
    if not sub_req:
        raise HTTPException(status_code=404, detail="Sub-requirement not found")
    
    evidence = RequiredEvidence(
        sub_requirement_id=sub_req_id,
        name=request.name,
        description=request.description,
        evidence_type=request.evidence_type
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)
    return {"message": "Required evidence created", "evidence_id": evidence.id}


@router.put("/admin/evidence/{evidence_id}")
def admin_update_required_evidence(evidence_id: int, request: RequiredEvidenceCreateRequest, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    evidence = db.query(RequiredEvidence).filter(RequiredEvidence.id == evidence_id).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Required evidence not found")
    
    evidence.name = request.name
    evidence.description = request.description
    evidence.evidence_type = request.evidence_type
    db.commit()
    return {"message": "Required evidence updated"}


@router.delete("/admin/evidence/{evidence_id}")
def admin_delete_required_evidence(evidence_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    evidence = db.query(RequiredEvidence).filter(RequiredEvidence.id == evidence_id).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Required evidence not found")
    
    db.delete(evidence)
    db.commit()
    return {"message": "Required evidence deleted"}


@router.get("/evidence/comparison")
def get_evidence_comparison(db: Session = Depends(get_db)):
    """Get comprehensive evidence comparison: required vs uploaded, grouped by requirement and phase"""
    requirements = db.query(Requirement).options(
        joinedload(Requirement.sub_requirements)
        .joinedload(SubRequirement.required_evidence)
        .joinedload(RequiredEvidence.submissions)
    ).order_by(Requirement.req_number).all()
    
    result = []
    for req in requirements:
        req_data = {
            "id": req.id,
            "req_number": req.req_number,
            "name": req.name,
            "sub_requirements": [],
            "total_required": 0,
            "total_uploaded": 0,
            "total_accepted": 0,
            "total_pending": 0,
            "total_rejected": 0
        }
        
        for sub_req in req.sub_requirements:
            sub_data = {
                "id": sub_req.id,
                "sub_req_number": sub_req.sub_req_number,
                "name": sub_req.name,
                "evidence": []
            }
            
            for ev in sub_req.required_evidence:
                req_data["total_required"] += 1
                
                submissions = sorted(ev.submissions, key=lambda x: x.uploaded_at, reverse=True) if ev.submissions else []
                has_accepted = any(s.status == EvidenceStatus.ACCEPTED.value for s in submissions)
                has_pending = any(s.status == EvidenceStatus.PENDING_REVIEW.value for s in submissions)
                has_rejected = any(s.status == EvidenceStatus.REJECTED.value for s in submissions)
                
                if submissions:
                    req_data["total_uploaded"] += 1
                if has_accepted:
                    req_data["total_accepted"] += 1
                if has_pending:
                    req_data["total_pending"] += 1
                if has_rejected and not has_accepted:
                    req_data["total_rejected"] += 1
                
                ev_data = {
                    "id": ev.id,
                    "name": ev.name,
                    "description": ev.description,
                    "evidence_type": ev.evidence_type,
                    "status": "accepted" if has_accepted else ("pending" if has_pending else ("rejected" if has_rejected else "not_uploaded")),
                    "submissions_count": len(submissions),
                    "latest_submission": {
                        "id": submissions[0].id,
                        "file_name": submissions[0].file_name,
                        "uploaded_by": submissions[0].uploaded_by,
                        "uploaded_at": submissions[0].uploaded_at.isoformat(),
                        "status": submissions[0].status,
                        "reviewed_by": submissions[0].reviewed_by,
                        "review_notes": submissions[0].review_notes
                    } if submissions else None
                }
                sub_data["evidence"].append(ev_data)
            
            req_data["sub_requirements"].append(sub_data)
        
        result.append(req_data)
    
    return {
        "requirements": result,
        "summary": {
            "total_required": sum(r["total_required"] for r in result),
            "total_uploaded": sum(r["total_uploaded"] for r in result),
            "total_accepted": sum(r["total_accepted"] for r in result),
            "total_pending": sum(r["total_pending"] for r in result),
            "total_rejected": sum(r["total_rejected"] for r in result)
        }
    }
