"""What an AI call carried, kept for the administrator who audits AI use: the prompt as it was sent (after the
data-protection guard, so with placeholders instead of names) and the model's answer as it came back (before the
placeholders were put back), encrypted, for a limited time (services/ai_gateway/ledger.py).

Never a picture: images are refused before a call is made."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Text

from ._00_base import Base


class AICallPayload(Base):
    __tablename__ = "ai_call_payloads"

    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("ai_usage_events.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    request_enc = Column(Text, nullable=True)         # encrypted (grc/crypto.py), text as sent
    response_enc = Column(Text, nullable=True)        # encrypted, text as the model answered
    truncated = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False, index=True)
