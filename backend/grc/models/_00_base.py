import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, ForeignKey, Boolean,
    Float, DateTime, Date, JSON, Index, Table, UniqueConstraint, LargeBinary,
    Numeric, inspect, text
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, backref
import logging

logger = logging.getLogger(__name__)

# Per-database-per-tenant: see grc.db for engine/session machinery.
# `engine` and `SessionLocal` here point at the MASTER (catalog) DB only — kept as
# module-level names so legacy imports keep resolving. Operational queries should
# go through `get_db` (tenant-scoped) or `get_master_db` (catalog-scoped).
from ..db import (
    master_engine as engine,
    MasterSession as SessionLocal,
    get_master_db,
    get_tenant_db,
    open_tenant_session,
)

Base = declarative_base()

