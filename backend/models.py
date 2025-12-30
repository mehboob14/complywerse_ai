import os
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, Boolean, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///pci_compliance.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Phase(Base):
    __tablename__ = "phases"

    id = Column(Integer, primary_key=True, index=True)
    phase_number = Column(Integer, nullable=False, unique=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="not_started")
    is_current = Column(Boolean, default=False)
    
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
    status = Column(String(50), default="not_started")
    evidence_needed = Column(Integer, default=0)
    
    requirement = relationship("Requirement", back_populates="sub_requirements")
    evidence_items = relationship("EvidenceItem", back_populates="sub_requirement", cascade="all, delete-orphan")


class EvidenceItem(Base):
    __tablename__ = "evidence_items"

    id = Column(Integer, primary_key=True, index=True)
    sub_requirement_id = Column(Integer, ForeignKey("sub_requirements.id"), nullable=False)
    name = Column(String(255), nullable=False)
    evidence_type = Column(String(100), nullable=False)
    is_uploaded = Column(Boolean, default=False)
    file_name = Column(String(255), nullable=True)
    upload_status = Column(String(50), nullable=True)
    uploaded_at = Column(DateTime, nullable=True)
    
    sub_requirement = relationship("SubRequirement", back_populates="evidence_items")


class Finding(Base):
    __tablename__ = "findings"

    id = Column(Integer, primary_key=True, index=True)
    sub_requirement_id = Column(Integer, ForeignKey("sub_requirements.id"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String(50), default="medium")
    status = Column(String(50), default="open")
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)


class Risk(Base):
    __tablename__ = "risks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    owner = Column(String(255), nullable=True)
    status = Column(String(50), default="pending")
    approved_by = Column(String(255), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
