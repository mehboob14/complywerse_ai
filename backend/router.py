from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from models import (get_db, Phase, PhaseTask, PhaseDeliverable, 
                   Requirement, SubRequirement, RequiredEvidence,
                   EvidenceSubmission, Finding, Risk,
                   EvidenceStatus, FindingStatus, RiskStatus,
                   SecurityScan, ComplianceAssessment, CDESystem)
import os
import uuid

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


class PhaseResponse(BaseModel):
    id: int
    phase_number: int
    name: str
    description: Optional[str]
    status: str
    is_current: bool
    tasks: List[TaskResponse]
    deliverables: List[DeliverableResponse]
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


@router.get("/phases", response_model=List[PhaseResponse])
def get_all_phases(db: Session = Depends(get_db)):
    phases = db.query(Phase).options(
        joinedload(Phase.tasks),
        joinedload(Phase.deliverables)
    ).order_by(Phase.phase_number).all()
    return phases


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
    db.commit()
    return {"message": "Task updated", "task_id": task_id, "is_complete": task.is_complete}


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
    uploaded_by: str = Form(default="IT Security"),
    db: Session = Depends(get_db)
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
        uploaded_by=uploaded_by,
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
    reviewer: str = "QSA Auditor",
    notes: str = None,
    db: Session = Depends(get_db)
):
    submission = db.query(EvidenceSubmission).filter(EvidenceSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    
    if action not in ["accept", "reject"]:
        raise HTTPException(status_code=400, detail="Action must be 'accept' or 'reject'")
    
    submission.reviewed_by = reviewer
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
    approved_by: str = "Business Owner",
    business_justification: str = None,
    db: Session = Depends(get_db)
):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    
    if action not in ["approve", "reject"]:
        raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")
    
    risk.approved_by = approved_by
    risk.approved_at = datetime.utcnow()
    risk.business_justification = business_justification
    risk.status = RiskStatus.APPROVED.value if action == "approve" else RiskStatus.REJECTED.value
    
    db.commit()
    return {"message": f"Risk {action}d", "status": risk.status}
