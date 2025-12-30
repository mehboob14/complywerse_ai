import os
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, Boolean, Float, DateTime, Enum
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import enum

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///pci_compliance.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    INFOSEC_TEAM = "infosec_team"
    QSA_AUDITOR = "qsa_auditor"
    BUSINESS_OWNER = "business_owner"
    IT_SECURITY = "it_security"
    AUDITOR = "auditor"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), default=UserRole.IT_SECURITY.value)
    display_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)


class EvidenceStatus(str, enum.Enum):
    PENDING_REVIEW = "pending_review"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class FindingStatus(str, enum.Enum):
    OPEN = "open"
    IN_REMEDIATION = "in_remediation"
    CLOSED = "closed"


class RiskStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class PhaseApprovalStatus(str, enum.Enum):
    NOT_REQUIRED = "not_required"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"


class Phase(Base):
    __tablename__ = "phases"

    id = Column(Integer, primary_key=True, index=True)
    phase_number = Column(Integer, nullable=False, unique=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="not_started")
    is_current = Column(Boolean, default=False)
    approval_status = Column(String(50), default=PhaseApprovalStatus.NOT_REQUIRED.value)
    approved_by = Column(String(255), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    
    tasks = relationship("PhaseTask", back_populates="phase", cascade="all, delete-orphan")
    deliverables = relationship("PhaseDeliverable", back_populates="phase", cascade="all, delete-orphan")


class PhaseTask(Base):
    __tablename__ = "phase_tasks"

    id = Column(Integer, primary_key=True, index=True)
    phase_id = Column(Integer, ForeignKey("phases.id"), nullable=False)
    name = Column(String(255), nullable=False)
    is_complete = Column(Boolean, default=False)
    
    phase = relationship("Phase", back_populates="tasks")


class PhaseDeliverable(Base):
    __tablename__ = "phase_deliverables"

    id = Column(Integer, primary_key=True, index=True)
    phase_id = Column(Integer, ForeignKey("phases.id"), nullable=False)
    name = Column(String(255), nullable=False)
    
    phase = relationship("Phase", back_populates="deliverables")


class Requirement(Base):
    __tablename__ = "requirements"

    id = Column(Integer, primary_key=True, index=True)
    req_number = Column(Integer, nullable=False, unique=True)
    name = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    
    sub_requirements = relationship("SubRequirement", back_populates="requirement", cascade="all, delete-orphan")


class SubRequirement(Base):
    __tablename__ = "sub_requirements"

    id = Column(Integer, primary_key=True, index=True)
    requirement_id = Column(Integer, ForeignKey("requirements.id"), nullable=False)
    sub_req_number = Column(String(20), nullable=False)
    name = Column(Text, nullable=False)
    
    requirement = relationship("Requirement", back_populates="sub_requirements")
    required_evidence = relationship("RequiredEvidence", back_populates="sub_requirement", cascade="all, delete-orphan")
    findings = relationship("Finding", back_populates="sub_requirement")


class RequiredEvidence(Base):
    __tablename__ = "required_evidence"

    id = Column(Integer, primary_key=True, index=True)
    sub_requirement_id = Column(Integer, ForeignKey("sub_requirements.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    evidence_type = Column(String(100), nullable=False)
    
    sub_requirement = relationship("SubRequirement", back_populates="required_evidence")
    submissions = relationship("EvidenceSubmission", back_populates="required_evidence", cascade="all, delete-orphan")


class EvidenceSubmission(Base):
    __tablename__ = "evidence_submissions"

    id = Column(Integer, primary_key=True, index=True)
    required_evidence_id = Column(Integer, ForeignKey("required_evidence.id"), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=True)
    uploaded_by = Column(String(100), default="IT Security")
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String(50), default=EvidenceStatus.PENDING_REVIEW.value)
    reviewed_by = Column(String(100), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    
    required_evidence = relationship("RequiredEvidence", back_populates="submissions")


class Finding(Base):
    __tablename__ = "findings"

    id = Column(Integer, primary_key=True, index=True)
    sub_requirement_id = Column(Integer, ForeignKey("sub_requirements.id"), nullable=True)
    evidence_submission_id = Column(Integer, ForeignKey("evidence_submissions.id"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String(50), default="medium")
    status = Column(String(50), default=FindingStatus.OPEN.value)
    remediation_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    
    sub_requirement = relationship("SubRequirement", back_populates="findings")


class Risk(Base):
    __tablename__ = "risks"

    id = Column(Integer, primary_key=True, index=True)
    sub_requirement_id = Column(Integer, ForeignKey("sub_requirements.id"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    risk_level = Column(String(50), default="medium")
    owner = Column(String(255), nullable=True)
    status = Column(String(50), default=RiskStatus.PENDING.value)
    business_justification = Column(Text, nullable=True)
    approved_by = Column(String(255), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SecurityScan(Base):
    __tablename__ = "security_scans"

    id = Column(Integer, primary_key=True, index=True)
    scan_type = Column(String(50), nullable=False)  # asv_scan, pen_test, vulnerability_scan
    name = Column(String(255), nullable=False)
    status = Column(String(50), default="scheduled")  # scheduled, in_progress, completed, failed
    scheduled_date = Column(DateTime, nullable=True)
    completed_date = Column(DateTime, nullable=True)
    findings_count = Column(Integer, default=0)
    critical_count = Column(Integer, default=0)
    high_count = Column(Integer, default=0)
    medium_count = Column(Integer, default=0)
    low_count = Column(Integer, default=0)
    report_path = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ComplianceAssessment(Base):
    __tablename__ = "compliance_assessments"

    id = Column(Integer, primary_key=True, index=True)
    assessment_type = Column(String(100), nullable=False)  # self_assessment, qsa_audit
    status = Column(String(50), default="in_progress")  # in_progress, completed
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    assessor_name = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)


class CDESystem(Base):
    __tablename__ = "cde_systems"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    system_type = Column(String(100), nullable=False)  # server, application, network, database
    description = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    location = Column(String(255), nullable=True)
    owner = Column(String(255), nullable=True)
    in_scope = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
