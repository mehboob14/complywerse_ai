"""Native Help Desk engine (Frappe → FastAPI conversion, step 2).

The ticket-core spine; parallel agents fill the sla/assignment/people/kb/
replies/dashboard stubs. Not mounted into the app yet — the Frappe proxy
(`grc/modules/helpdesk`) is still the live router; cutover is a later step.
"""
from .router import router as helpdesk_native_router

__all__ = ["helpdesk_native_router"]
