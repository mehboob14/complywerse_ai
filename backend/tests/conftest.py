"""Test-session defaults.

The platform clock starts with the app and queues real jobs against the master
database. A test that boots the app must not do that, so it is off here; the
clock's own tests drive it directly.
"""
import os

os.environ.setdefault("DISABLE_PLATFORM_CLOCK", "1")
