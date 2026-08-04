"""Pytest bootstrap for the backend test suite.

Sets a dummy SESSION_SECRET (the config layer reads it at import time) and makes
the backend directory importable as the package root, so `import grc...` resolves
whether pytest is invoked from the repo root or backend/.
"""
import os
import sys

os.environ.setdefault("SESSION_SECRET", "test_secret_0123456789_abcdefghijklmnop")

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
