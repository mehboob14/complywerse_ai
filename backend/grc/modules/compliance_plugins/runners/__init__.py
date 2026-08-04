"""Per-runner-type plugin executors.

Importing :mod:`.registry` triggers its own side-effect imports of every
runner module (aws / oracle / ssh / winrm), which in turn execute the
``@register(...)`` decorators that populate ``RUNNERS``. We re-export the
public symbols so callers can simply do ``from ...runners import RUNNERS``.
"""

from .registry import RUNNERS, register, RunnerFn, run_check

__all__ = ["RUNNERS", "register", "RunnerFn", "run_check"]
