"""AI Studio (modules/governance/studio): a working document with its chat, revisions and references, before it is in the
library or beside a library document being edited; plus the templates and logos a tenant keeps for it."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import validates

from ._00_base import Base


class StudioSession(Base):
    __tablename__ = "grc_studio_sessions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    title = Column(String(500), nullable=False, default="Untitled document")
    kind = Column(String(20), nullable=False, default="new")             # new | upload | library
    doc_type = Column(String(50), nullable=False, default="policy")
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)    # the library document, once there is one
    status = Column(String(20), nullable=False, default="active")        # active | archived | moved
    content = Column(Text, nullable=False, default="")                   # the working Markdown
    base_content = Column(Text, nullable=False, default="")              # what "changes" are measured against
    base_label = Column(String(200), nullable=True)
    revision_no = Column(Integer, nullable=False, default=0)
    instructions = Column(JSON, nullable=False, default=dict)            # entity name, logo, focus areas, requirements, tone, language ...
    settings = Column(JSON, nullable=False, default=dict)                # auto_apply ...
    template_id = Column(String(40), nullable=True)
    source_kind = Column(String(20), nullable=False, default="none")     # none | docx | pdf | text | md | html
    source_name = Column(String(255), nullable=True)
    source_path = Column(String(500), nullable=True)                     # the file edits are written into (a Word file is patched in place)
    source_original_path = Column(String(500), nullable=True)            # the file exactly as it was uploaded
    native_map = Column(JSON, nullable=True)                             # where each base block lives in the source file
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_opened_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_studio_session_user", "created_by", "status"),)


class StudioRevision(Base):
    __tablename__ = "grc_studio_revisions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("grc_studio_sessions.id"), nullable=False, index=True)
    number = Column(Integer, nullable=False)
    author_type = Column(String(20), nullable=False, default="user")     # user | ai | import | system | restore
    author_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    summary = Column(String(500), nullable=True)
    content = Column(Text, nullable=False, default="")
    stats = Column(JSON, nullable=True)                                  # blocks and words changed since the revision before
    message_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (Index("ix_studio_revision_session", "session_id", "number"),)


class StudioMessage(Base):
    __tablename__ = "grc_studio_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("grc_studio_sessions.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)                            # user | assistant
    kind = Column(String(20), nullable=False, default="chat")            # chat | checks | compare
    content = Column(Text, nullable=False, default="")
    status = Column(String(20), nullable=False, default="done")          # working | done | error
    stage = Column(String(120), nullable=True)                           # what a working turn is doing
    live = Column(JSON, nullable=True)                                   # what the screen shows while it works (steps, text so far, parts); gone once it is done
    error = Column(Text, nullable=True)
    proposal = Column(JSON, nullable=True)                               # the AI's changes, each pending | accepted | rejected | conflict
    references_used = Column(JSON, nullable=True)
    questions = Column(JSON, nullable=True)                              # what Comply Agent asks: [{id, question, why, kind, options, other, answer?}] (older: plain strings)
    answers = Column(JSON, nullable=True)                                # on a person's message: {reply_to, items: [{id, question, chosen, other}]}
    notes = Column(JSON, nullable=True)                                  # things the person should know (a change that could not be placed ...)
    base_revision = Column(Integer, nullable=True)                       # the revision the AI read
    usage = Column(JSON, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    @validates("status")
    def _forget_live(self, _key, value):
        """A turn that is no longer working keeps no live view: whoever finishes a message (the engine, the reaper) clears it with the status."""
        if value != "working":
            self.live = None
        return value


class StudioReference(Base):
    __tablename__ = "grc_studio_references"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("grc_studio_sessions.id"), nullable=False, index=True)
    ref_key = Column(String(10), nullable=False)                         # R1, R2 ...: what the AI cites
    kind = Column(String(30), nullable=False)                            # parent_document | document | framework | upload | template
    title = Column(String(500), nullable=False)
    source_id = Column(Integer, nullable=True)                           # the library document or framework it came from
    source_label = Column(String(300), nullable=True)
    scope = Column(JSON, nullable=True)                                  # for a framework: which controls
    text = Column(Text, nullable=False, default="")                      # the text as it was when attached (so every turn sees the same)
    char_count = Column(Integer, nullable=False, default=0)
    truncated = Column(Boolean, nullable=False, default=False)
    include = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class StudioTemplate(Base):
    __tablename__ = "grc_studio_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    doc_type = Column(String(50), nullable=False, default="policy")
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=False, default="")
    structure = Column(JSON, nullable=True)                              # the sections a document of this type must have
    is_default = Column(Boolean, nullable=False, default=False)          # used for new documents of this type instead of the built-in one
    archived = Column(Boolean, nullable=False, default=False)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class StudioAsset(Base):
    __tablename__ = "grc_studio_assets"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False, default="logo")
    name = Column(String(200), nullable=False)
    file_path = Column(String(500), nullable=False)
    mime = Column(String(100), nullable=False)
    size = Column(Integer, nullable=False, default=0)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    sha256 = Column(String(64), nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
