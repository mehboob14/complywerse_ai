"""Native Help Desk EMAIL model (engine conversion, step 2).

Frappe ran the Help Desk mailbox through its framework `Email Account` doctype
(+ child `IMAP Folder` with `append_to = HD Ticket`). None of that carried over
when the fork was dropped, so this is the native store: ONE row per configured
mailbox, holding both the outbound (SMTP) and inbound (IMAP) halves Frappe split
across the Email Account's outgoing/incoming sections.

Conventions follow _60 (table `grc_hd_<name>`, Integer PK, `tenant_id` FK on the
top-level table). Credentials are stored encrypted at rest via `grc.crypto`
(enc:v1: Fernet) — the module layer encrypts on write / decrypts on use, so the
column just holds the ciphertext. A separate file per the task; _60 is untouched.
"""
from ._60_helpdesk_native_models import *  # noqa: F401,F403 — Base, Column types, datetime, relationship


class HDEmailAccount(Base):
    __tablename__ = "grc_hd_email_account"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    name = Column(String(140), nullable=False)             # human label (Frappe email_account_name)
    email_id = Column(String(255), nullable=True)          # the mailbox / From address
    from_name = Column(String(140), nullable=True)         # display name on outbound mail

    # which halves are live + which account is the default sender
    enable_incoming = Column(Boolean, default=False)       # poll this mailbox for new tickets/replies
    enable_outgoing = Column(Boolean, default=False)       # may send notifications from here
    default_outgoing = Column(Boolean, default=False)      # the sender for ticket notifications

    # --- outbound (SMTP) ---
    smtp_host = Column(String(255), nullable=True)
    smtp_port = Column(Integer, default=587)
    smtp_user = Column(String(255), nullable=True)
    smtp_password = Column(Text, nullable=True)            # encrypted at rest (crypto.encrypt_secret)
    smtp_use_tls = Column(Boolean, default=True)           # STARTTLS (587); False => SMTP_SSL (465)

    # --- inbound (IMAP) ---
    imap_host = Column(String(255), nullable=True)
    imap_port = Column(Integer, default=993)
    imap_user = Column(String(255), nullable=True)
    imap_password = Column(Text, nullable=True)            # encrypted at rest
    imap_use_ssl = Column(Boolean, default=True)
    imap_folder = Column(String(140), default="INBOX")     # Frappe IMAP Folder.folder_name
    last_polled_at = Column(DateTime, nullable=True)       # Frappe last_synced_at (observability only)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_hd_email_account_tenant", "tenant_id"),
    )
