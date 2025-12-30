import os
from sqlalchemy import create_engine, Column, Integer, String, Text, ForeignKey, UniqueConstraint, Enum
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
import enum

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///pci_compliance.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class EvidenceStatus(enum.Enum):
    PENDING = "Pending"
    ACCEPTED = "Accepted"
    REJECTED = "Rejected"


class Control(Base):
    __tablename__ = "controls"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    pci_requirement = Column(String(100), nullable=False)
    
    required_evidence = relationship("RequiredEvidence", back_populates="control", cascade="all, delete-orphan")
    uploaded_evidence = relationship("UploadedEvidence", back_populates="control", cascade="all, delete-orphan")


class RequiredEvidence(Base):
    __tablename__ = "required_evidence"

    id = Column(Integer, primary_key=True, index=True)
    control_id = Column(Integer, ForeignKey("controls.id"), nullable=False)
    evidence_name = Column(String(255), nullable=False)
    evidence_type = Column(String(100), nullable=False)
    
    control = relationship("Control", back_populates="required_evidence")
    
    __table_args__ = (
        UniqueConstraint('control_id', 'evidence_name', name='uq_control_evidence'),
    )


class UploadedEvidence(Base):
    __tablename__ = "uploaded_evidence"

    id = Column(Integer, primary_key=True, index=True)
    control_id = Column(Integer, ForeignKey("controls.id"), nullable=False)
    required_evidence_id = Column(Integer, ForeignKey("required_evidence.id"), nullable=True)
    file_name = Column(String(255), nullable=False)
    evidence_type = Column(String(100), nullable=False)
    status = Column(String(20), nullable=False, default="Pending")
    
    control = relationship("Control", back_populates="uploaded_evidence")
    required_evidence = relationship("RequiredEvidence")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
