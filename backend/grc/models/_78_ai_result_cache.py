"""Answers of AI calls that are asked again exactly as before (services/ai_gateway/cache.py): the same sanitised prompt
gets the same answer without another call. Per tenant, encrypted, expiring."""
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from ._00_base import Base


class AIResultCache(Base):
    __tablename__ = "ai_result_cache"

    key = Column(String(64), primary_key=True)                  # sha256 of the sanitised prompt and the settings that shape the answer
    use_case_id = Column(String(150), nullable=True, index=True)
    api = Column(String(20), nullable=False)                    # chat | responses
    model = Column(String(150), nullable=True)
    response_enc = Column(Text, nullable=False)                 # the whole response as the model sent it (placeholders still in it), encrypted
    tokens = Column(Integer, nullable=False, default=0)         # what the original call used: what each hit saves
    hits = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_hit_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)
